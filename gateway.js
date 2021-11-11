/**
 * @file gateway.js
 * @brief UART 2-way communication handler for SensorTags
 * @author Vili Pelttari
 *
 * Dependencies (npm):
 *    socket.io-client
 *    serialport
 *    queue-fifo
 *    moment
 *    mqtt
 *
 * Capabilities:
 *    - 2-way UART communication with a SensorTag. Receives and sends messages
 *    - Should automatically find the right port
 *    - Sends data to the backend over a TLS connection
 *    - Receives data from backend over a TLS connection
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
   gateway = require("./config");
    readline = require("readline");
      reader = require("./lib/reader");
        uart = require("./lib/uart");
        util = require("./lib/util");
        comm = require("./lib/comm-socket");

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
    util.showMsg("error", "Bad port: " + err.message);
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
    util.showMsg("error", "Error opening port parser: " + e.message);
    return;
  }

  if (gateway.isServer) {
    uart.hbTime = Date.now();
    heartbeatService = setInterval(uart.heartbeat, gateway.heartbeatInterval); // check ServerTag every 15 seconds
  }

  gateway.port.on("close", (err) => { // disconnection detection is slow on some devices
    if (err != null && err.disconnected) {
      util.showMsg("error", "The SensorTag server disconnected from USB! Please reconnect.");
    } else if (err != null) {
      util.showMsg("error", "Unencountered error with UART connection. Attempting to reconnect.");
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
    util.showMsg("info", "UART connection opened.");
    if (gateway.isServer) setTimeout(uart.sendChallenge, 1000);
    else uart.responded = true;
    parser.on("data", function(data) {
      if (!uart.responded && !uart.parseChallenge(data)) return;
      // read the data, send via MQTT on success and show errors in console on failure
      reader.unwrap(data).then(comm.sendMsgs).catch(str => util.showMsg("error", str));
    });
  });
}

function sendDebugMsgs(msg) {
  let buff;
  if (gateway.isServer) {
    buff = Buffer.concat([Buffer.from([Number.parseInt(debug.id.substr(2), 16), Number.parseInt(debug.id.substr(0, 2), 16)]), Buffer.from(msg)]);
  } else {
    buff = Buffer.concat([Buffer.from("id:" + debug.id + ","), Buffer.from(msg)]);
  }
  reader.unwrap(buff).then(comm.sendMsgs).catch(str => util.showMsg("error", str));
}

function sendSensorData() {
  debug.k--;
  sendDebugMsgs("press:" + (debug.k % 10) + ((debug.k == 0) ? ",session:end" : ""));

  if (debug.k <= 0) clearInterval(debug.sensorData);
}

/**
 * @brief Handles the console/terminal input from user when the UART is connected
 * @param line The line read from stdin
 */
function consoleHandler(line) {
  if (line[0] == '.') {
    if (line == ".reconnect") {
      gateway.port.close(err => {if (err) {util.showMsg("error", "Port close error: "+err);}});
      util.showMsg("info", "\n");
    } else if (line == ".mute") {
      gateway.muteConnectionError = true;
      util.showMsg("info", "Subscriber connection errors muted.\n");
    } else if (line == ".unmute") {
      gateway.muteConnectionError = false;
      util.showMsg("info", "Subscriber connection errors unmuted.\n")
    } else if (gateway.debugMode && line.startsWith(".setid ")) {
      if (line.length = 11) {
        debug.id = line.substring(7)
        util.showMsg("info", `Set Debug ID to ${debug.id}.`);
      } else util.showMsg("info", `Could not set Debug ID to ${line.substring(7)}`);
    } else if (gateway.debugMode && line.startsWith(".eat ")) {
      let d = Number(line.substring(5));
      if (isNaN(d)) {
        util.showMsg("info", "Could not interpret the command '" + line + "'");
        return;
      }
      sendDebugMsgs("EAT:" + d);
    } else if (gateway.debugMode && line.startsWith(".exercise ")) {
      let d = Number(line.substring(5));
      if (isNaN(d)) {
        util.showMsg("info", "Could not interpret the command '" + line + "'");
        return;
      }
      sendDebugMsgs("EXERCISE:" + d);
    } else if (gateway.debugMode && line.startsWith(".pet ")) {
      let d = Number(line.substring(5));
      if (isNaN(d)) {
        util.showMsg("info", "Could not interpret the command '" + line + "'");
        return;
      }
      sendDebugMsgs("PET:" + d);
    } else if (gateway.debugMode && line.startsWith(".send ")) {
      sendDebugMsgs(line.substr(6));
    } else if (gateway.debugMode && line == ".sendSensors") {
      debug.k = 40;
      sendDebugMsgs("session:start");
      debug.sensorData = setInterval(sendSensorData, 100);
    } else if (line == ".help") {
      let sendInstruction = gateway.isServer ?
          "\nAny message not starting with '.' will be sent to address 0xffff."
            + "\nAddress can be specified using XXXX# prefix.\n"
          :
          "\nAny message not starting with '.' will be sent to the SensorTag.\n";
      util.showMsg("info", "Supported commands:\n" +
        "  .reconnect   Force port reconnect\n" +
        "  .mute        Mute the 'Broker unreachable' warning\n" +
        "  .unmute      Unmute the 'Broker unreachable' warning\n" + sendInstruction);
    } else util.showMsg("info", "Unknown command");
  } else if (!gateway.isServer) { // not server, so all input is sent raw (internal: true)
    uart.uartWrite({internal: true, str: line});
  } else if (/[0-9a-f]{4}#.+/i.test(line)) { // check if the sensortag address is given in the beginning as 6261#message for sending "message" to id:ab
    let parts = line.split(/#(.+)/, 2);
    uart.uartWrite({addr: parts[0], str: parts[1]});
  } else if (line.length > 0) { // gateway is server, so send all other data as broadcast messages
    uart.uartWrite({addr: "ffff", str: line});
  }
}

// SIGINT handler
process.once('SIGINT', function(code) {
  util.showMsg("info", "Gateway encountered SIGINT. Exiting.").then(() => {gateway.port.close(err => {if (err) {util.showMsg("error", "Port close error: "+err);}}); comm.end("SIGINT")}).catch((err) => comm.end("SIGINT"));
});
// SIGTERM handler
process.once('SIGTERM', function(code) {
  util.showMsg("info", "Gateway encountered SIGTERM. Exiting.").then(() => {gateway.port.close(err => {if (err) {util.showMsg("error", "Port close error: "+err);}}); comm.end("SIGTERM")}).catch((err) => comm.end("SIGTERM"));
});

let debug = {id: "0123"};

// Start communication to backend
if (!gateway.offline) comm.startComm();
// Start program
if (!gateway.debugMode) {
  process.stdout.write("\033[s"); // save cursor position
  portFinder.init(consoleHandler);
  portFinder.findPorts().then(main);
} else {
  //reader.unwrap(Buffer.from("adping,event:UP\x00\x00")).then(console.log).catch(console.error);
  util.rl.on("line", consoleHandler);
  if (gateway.isServer) { // TODO make automated tests with Mocha
    //sendDebugMsgs("EAT:8,ACTIVATE:1;3;-3,session:start,press:1013.25");
    //reader.unwrap(Buffer.from("abEAT:8,ACTIVATE:1;3;-3,session:start,press:1013.25,ping")).then(comm.sendMsgs).catch(console.error);
  } else {
    //let fun = async () => {
      //await reader.unwrap(Buffer.from("id:0123,EAT:3\r\n")).then(console.log).catch(console.error);
    //}
    //fun();
  }
}
