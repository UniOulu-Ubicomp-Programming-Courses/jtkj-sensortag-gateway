/**
 * @file gateway.js
 * @brief UART 2-way communication handler for SensorTags
 * @author Vili Pelttari
 *
 * Dependencies (npm):
 *    serialport
 *    queue-fifo
 *    moment
 *    mqtt
 *
 * Capabilities:
 *    - 2-way UART communication with a SensorTag. Receives and sends messages
 *    - Should automatically find the right port
 *    - Sends data to the MQTT broker
 *    - Receives data over MQTTS subscription
 *
 * Usage: Plug in a SensorTag via USB and run this file in powershell or similar with Node.js.
 *  - run powershell
 *  - navigate to this folder and run command "npm install; node gateway"
 *
 * Windows: Set Quick Edit Mode and Insert Mode off in running terminal. This stops the process
 * from sleeping.
 *
 */
const
  ByteLength = require("@serialport/parser-byte-length");
   Delimiter = require("@serialport/parser-delimiter");
  portFinder = require("./lib/portFinder");
  SerialPort = require("serialport");
    readline = require("readline");
     gateway = require("./config");
      reader = require("./lib/reader");
        uart = require("./lib/uart");
        comm = require("./lib/comm");

/**
 * @brief The main program. Handles UART communication
 * @param Path The path to a serial port that is for the SensorTag
 *
 * The port will be tested with a challenge - response scheme. This prevents plugging in wrong
 * ServerTags and realigns the parse buffers on both ends if necessary. The ServerTag health
 * will be monitored with heartbeat messaging.
 */
function main(path) {
  let parser, heartbeatService;
  gateway.port = new SerialPort(path, {baudRate: gateway.uart.baudRate}, function(err) {
    if (err === null) return;
    showMsg("error", "Bad port: " + err.message);
    portFinder.findPorts().then(main);
    return; // leave portfinder to searching and exit main meanwhile
  });

  try {
    if (gateway.uart.pipe == "length"){
      parser = gateway.port.pipe(new ByteLength({length: gateway.uart.rxlength}));
    } else {
      parser = gateway.port.pipe(new Delimiter({delimiter: gateway.uart.delim}));
    }
  } catch(e) {
    showMsg("error", "Error opening port parser: " + e.message);
    return;
  }

  if (gateway.isServer) {
    uart.hbTime = Date.now();
    heartbeatService = setInterval(uart.heartbeat, gateway.heartbeatInterval); // check ServerTag every 15 seconds
  }

  gateway.port.on("close", (err) => { // disconnection detection is slow on some devices
    if (err != null && err.disconnected) {
      showMsg("error", "The SensorTag server disconnected from USB! Please reconnect.");
    } else if (err != null) {
      showMsg("error", "Unencountered error with UART connection. Attempting to reconnect.");
    }
    setTimeout(() => {
      if (uart.responded) {
        process.stdout.write("\033[2J\033[1H\033[s"); // clear console, move cursor to first line, save position
        uart.responded = false;
      }
      if (gateway.isServer) clearInterval(heartbeatService);
      parser.destroy();
      portFinder.findPorts().then(main); // retry connection
      return; // leave portfinder to searching and exit main meanwhile
    }, 1500);
  });

  // Main functionality after connection is established:
  gateway.port.on("open", () => {
    let dict = [], topic = "";
    showMsg("info", "UART connection opened.");
    if (gateway.isServer) setTimeout(uart.sendChallenge, 1000);
    else uart.responded = true;
    parser.on("data", function(data) {
      if (!uart.responded && !uart.parseChallenge(data)) return;
      // read the data, send via MQTT on success and show errors in console on failure
      reader.unwrap(data).then(comm.sendMsgs).catch(console.error);
    });
  });
}

/**
 * @brief Handles the console/terminal input from user when the UART is connected
 * @param line The line read from stdin
 */
function consoleHandler(line) {
  if (line[0] == '.') {
    if (line == ".reconnect") {
      gateway.port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}});
      console.log("\n");
    } else if (line == ".mute") {
      gateway.muteConnectionError = true;
      console.log("Subscriber connection errors muted.\n")
    } else if (line == ".unmute") {
      gateway.muteConnectionError = false;
      console.log("Subscriber connection errors unmuted.\n")
    } else if (line == ".help") {
      let sendInstruction = gateway.isServer ?
          "\nAny message not starting with '.' will be sent to address 0xffff."
            + "\nAddress can be specified using XXXX# prefix.\n"
          :
          "\nAny message not starting with '.' will be sent to the SensorTag.\n";
      console.log("Supported commands:\n" +
        "  .reconnect   Force port reconnect\n" +
        "  .mute        Mute the 'Broker unreachable' warning\n" +
        "  .unmute      Unmute the 'Broker unreachable' warning\n" + sendInstruction);
    } else console.log("Unknown command");
  } else if (!gateway.isServer) { // not server, so all input is sent raw (internal: true)
    uart.uartWrite({internal: true, str: line});
  } else if (/[0-9a-f]{4}#.+/i.test(line)) { // check if the sensortag address is given in the beginning as 6261#message for sending "message" to id:ab
    let parts = line.split(/#(.+)/, 2);
    uart.uartWrite({addr: parts[0], str: parts[1]});
  } else if (line.length > 0) { // gateway is server, so send all other data as broadcast messages
    uart.uartWrite({addr: "ffff", str: line});
  }
}

/**
 * @brief Send a message on all interfaces (the console and the MQTTS broker)
 * @param topic The MQTT topic on which this message should be published on
 * @param str The message
 * @return A resolve promise for knowing when the MQTTS publish has been completed.
 */
function showMsg(topic, str) {
  return new Promise(resolve => {
    console.log(str);
    //comm.send(topic, str).then(resolve); // can forward error to MQTT broker
    resolve();
  });
}

// readline interface for reading console input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// SIGINT handler
process.once('SIGINT', function(code) {
  showMsg("info", "Gateway encountered SIGINT. Exiting.").then(() => {gateway.port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}}); comm.end("SIGINT")}).catch((err) => comm.end("SIGINT"));
});
// SIGTERM handler
process.once('SIGTERM', function(code) {
  showMsg("info", "Gateway encountered SIGTERM. Exiting.").then(() => {gateway.port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}}); comm.end("SIGTERM")}).catch((err) => comm.end("SIGTERM"));
});

// Start MQTT
comm.startMQTT();
// Start program
process.stdout.write("\033[s"); // save cursor position
portFinder.init(rl, showMsg, consoleHandler);
portFinder.findPorts().then(main);

/*unwrap(Buffer.from("adping,event:UP\x00\x00")).then(console.log).catch(console.error);
if (gateway.isServer) { // TODO make automated tests with Mocha
  unwrap(Buffer.from("abevent:UP")).then(console.log).catch(console.error);
} else {
  let fun = async () => {
    await unwrap(Buffer.from("id:0123,evet:Up\r\n")).then(comm.sendMsgs).catch(console.error);
    await unwrap(Buffer.from("id:0123,event:Up\r\n")).then(comm.sendMsgs).catch(console.error);
    await unwrap(Buffer.from("event:UP,light:32\r\n")).then(console.log).catch(console.error);
    await unwrap(Buffer.from("id:0123,ping,event:UP,light:32\r\n")).then(console.log).catch(console.error);
    await unwrap(Buffer.from("id:0100,session:start,press:101325,time:2\r\n")).then(comm.sendMsgs).catch(console.error);
    await unwrap(Buffer.from("id:0100,event:UP,press:101326,time:3,light:208,session:end\r\n")).then(comm.sendMsgs).catch(console.error);
    await unwrap(Buffer.from("id:0100,event:UP,time:15\r\n")).then(comm.sendMsgs).catch(console.error);
    await unwrap(Buffer.from("id:6261,event:UP,ping\r\n")).then(comm.sendMsgs).catch(console.error);
  }
  fun();
}*/

/*console.log(
  util.decodeEscapedBuffer(Buffer.from([65, 241, 241, 240, 240, 66, 240, 240, 241, 67, 240, 241]))
);

console.log(
  util.decodeEscapedBuffer(Buffer.from([65, 66, 240, 240, 240, 241, 67, 240, 241]))
);*/
