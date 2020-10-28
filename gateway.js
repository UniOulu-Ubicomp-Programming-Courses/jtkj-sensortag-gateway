/**
 * @file gateway.js
 * @brief UART 2-way communication handler for SensorTags
 * @author Vili Pelttari
 * @date 27.10.2020
 *
 * Dependencies (npm):
 *    serialport
 *    moment
 *    mqtt
 *
 * Capabilities:
 *    - 2-way UART communication with a SensorTag. Receives and sends messages
 *    - Should automatically find the right port
 *    - Sends data to the MQTT broker
 *    - Receives data over MQTTS subscription
 *    - Nice terminal interface
 *
 * Usage: Plug in a SensorTag via USB and run this file in powershell or similar with node.js.
 *  - run powershell
 *  - navigate to this folder and run command "npm install; node gateway"
 *
 */
const
  ByteLength = require("@serialport/parser-byte-length");
   Delimiter = require("@serialport/parser-delimiter");
  portFinder = require("./lib/portFinder");
  SerialPort = require("serialport");
    readline = require("readline");
     gateway = require("./config");
      moment = require("moment");
        comm = require("./lib/comm");
        util = require("./lib/util");
          fs = require("fs");

let port; // the serial port after it has been found and connected to

let responded = false;
/**
 * @brief The main program. Handles UART communication and the finicky ByteLength parser
 * @param port Instance of a SerialPort to use
 *
 * The port will be tested with a challenge - response scheme. This prevents plugging in wrong
 * ServerTags and realigns the parse buffers on both ends if necessary. Hopefully they will not go
 * out of sync after a stable connection has been established (add logic to port.on('data')).
 */
function main(serial) {
  let parser;
  port = serial;

  try {
    if (gateway.uart.pipe == "length")
        parser = port.pipe(new ByteLength({length: gateway.uart.rxlength}));
    else
        parser = port.pipe(new Delimiter({delimiter: gateway.uart.delim}));
  } catch(e) {
    showMsg("error", "Error opening port parser: " + e.message);
    return;
  }

  port.on("close", function(err) { // disconnection detection is slow on some devices
    if (err != null && err.disconnected) {
      showMsg("error", "The SensorTag server disconnected from USB! Please reconnect.");
    } else if (err != null) {
      showMsg("error", "Unencountered error with UART connection. Attempting to reconnect.");
    }
    setTimeout(() =>{
      if (responded) {
        process.stdout.write("\033[2J\033[1H\033[s"); // clear console, move cursor to first line, save position
        responded = false;
      }
      parser.destroy();
      portFinder.findPorts(main); // retry connection
    }, 1500);
  });

  port.on("open", function() {
    let dict = [], topic = "";
    showMsg("info", "UART connection opened.");
    // TODO clear the read "length" pipe after every read to prevent out-of-sync buffer on start.
    // Buffer clearing not implemented in serialport library yet?
    if (gateway.uart.pipe == "length" && gateway.isServer)
      setTimeout(sendChallenge, 1000);
    else responded = true;
    parser.on("data", function(data) {
      if (!responded && !parseChallenge(data)) return;
      // read the data
      unwrap(data).then(comm.sendMsgs).catch(console.error);
    });
  });
}

/**
 * @brief Check the response to the challenge and set the current state as necessary
 * @param data The UART data buffer
 * @return Whether or not the response was satisfactory
 */
function parseChallenge(data) {
  let str;
  if (gateway.debugMode) {
    console.log("UART:", JSON.stringify(data.toString().replace(/\x00*$/, '')));
  }
  if (data[0] == data[1] && data[1] == 0xfe && data[2] == 1) {
    str = data.slice(3).toString().replace(/\0*$/g, '');
    showMsg("info", "Challenge response: " + str);
    portFinder.clearBlacklist();
    responded = true;
  }
  return false;
}

/**
 * @brief Send a challenge to the newly connected ServerTag and start a timeout for the function
 *        that will disconnect it if it didn't respond correctly
 */
function sendChallenge() {
  uartWrite({str: "\x00\x00\x01Identify", internal: true}, false);
  responded = false;
  setTimeout(function() { // wait the grace period and check 'responded' after that
    if (!responded) {
      showMsg("info", "No response to challenge. Disconnecting.");
      portFinder.nextPort();
      port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}}); // activates port.on('close')
      console.log("\n");
      return;
    }
  }, 3000);
}

/**
 * @brief Read key-value pairs from received SensorTag message
 * @param data The SensorTag message
 * @return A dictionary with interpreted results?
 */
function unwrap(data) {
  let resultDicts = {}, sends = [], addr, tmp, pair, dtype;
  return new Promise(async (resolve, reject) => {
    if (gateway.isServer) {
      addr = ("0000" + data.readUInt16LE().toString(16)).slice(-4);
      data = "id:" + addr + "," + data.slice(2).toString();
    } else data = data.toString();
    console.log(">", data.trim());
    tokens = data.split(",");
    for (const token of tokens) {
      pair = token.split(":").map(d => d.trim()); // pair = [name, value]
      dtype = gateway.dataTypes.find(type => type.shortName == pair[0]);
      if (dtype != undefined) {
        await dtype.fun(pair[1].replace(/\x00/g, '')).then(
          d => {
            for (const table of dtype.topics) {
              if (dtype.forceSend && !sends.includes(table)) sends.push(table);
              if (!(table in resultDicts)) resultDicts[table] = {};
              resultDicts[table][dtype.nameInDB] = d;
            }
          },
          reject /* pass error forward */);
      } else {
        // Couldn't find the name in the dataTypes. Find closest match...
        reject("Error: Unknown field label \"" + pair[0] + "\". Did you mean \"" +
          util.closestMatch(pair[0].toLowerCase(), gateway.dataTypes.map(d=>d.shortName)) + "\"?");
      }
    }
    for (const topic of gateway.topics)
      if (!sends.includes(topic)) resultDicts[topic] = null;
    resolve(resultDicts);
  });
}

/**
 * @brief Handles the console/terminal input from user when the UART is connected
 * @param line The line read from stdin
 */
function consoleHandler(line) {
  if (line[0] == '.') {
    if (line == ".reconnect") {
      port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}});
      console.log("\n");
    } else if (line == ".mute") {
      gateway.muteConnectionError = true;
      console.log("Subscriber connection errors muted.\n")
    } else if (line == ".unmute") {
      gateway.muteConnectionError = false;
      console.log("Subscriber connection errors unmuted.\n")
    } else if (line == ".help") {
      console.log("Supported commands:\n" +
        "  .reconnect   Force port reconnect\n" +
        "  .mute        Mute the 'Broker unreachable' warning\n" +
        "  .unmute      Unmute the 'Broker unreachable' warning\n");
    } else console.log("Unknown command");
  } else if (!gateway.isServer) {
    uartWrite({internal: true, str: line});
  } else if (/[0-9a-f]{4}#.+/i.test(line)) {
    let parts = line.split(/#(.+)/, 2);
    uartWrite({addr: parts[0], str: parts[1]});
  } else if (line.length > 0) {
    uartWrite({addr: "ffff", str: line});
  }
}

/**
 * @brief Writes TXLENGTH bytes to the open serial port
 * @param msg Dictionary describing what to send. 'str' is a necessary field. If 'addr' is
 *        specified, ServerTag will send an 6LoWPAN message to the provided address. If 'internal'
 *        is given, raw text will be sent.
 *          -str:      Message text (converted to ascii in this function, to prevent buffer problems)
 *          -addr:     Receiver address as a string of four hex characters ('ffff' is broadcast)
 *          -internal: Set if raw text has to be sent over UART
 */
function uartWrite(msg, publish=true) {
  let txBuf = Buffer.alloc(gateway.uart.txlength), addr = "ffff";
  if (gateway.isServer && !("internal" in msg)) {
    if ("addr" in msg && msg.addr != null)
      addr = msg.addr;
    txBuf.hexWrite(addr);
    txBuf.asciiWrite(msg.str, 2);
  } else {
    txBuf.asciiWrite(msg.str);
  }

  port.write(txBuf, function(err) {
    if (err) {
      showMsg("error", "UART write error: " + err.message);
    } else if (publish && port.isOpen) {
      showMsg("info", "Sent '" + msg.str.replace(/\0/g, '') + ("addr" in msg ? "' to 0x" + msg.addr : "'"));
    } else if (publish) {
      showMsg("error", "Sending aborted. SensorTag isn't connected.");
    }
  });
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
    comm.send(topic, str).then(resolve);
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
  showMsg("info", "Gateway encountered SIGINT. Exiting.").then(() => {port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}}); comm.end("SIGINT")});
});
// SIGTERM handler
process.once('SIGTERM', function(code) {
  showMsg("info", "Gateway encountered SIGTERM. Exiting.").then(() => {port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}}); comm.end("SIGTERM")});
});

// Start MQTT
comm.startMQTT();
// Start program
process.stdout.write("\033[s"); // save cursor position
portFinder.init(rl, showMsg, comm.send, consoleHandler);
portFinder.findPorts(main);
/*if (gateway.isServer) { // TODO make tests with Mocha
  unwrap(Buffer.from("abevent:UP")).then(console.log).catch(console.error);
} else {
  let fun = async () => {
    await unwrap(Buffer.from("id:0123,evet:Up,light:32\r\n")).then(comm.sendMsgs).catch(console.error);
    await unwrap(Buffer.from("id:0123,event:Up,light:32\r\n")).then(comm.sendMsgs).catch(console.error);
    await unwrap(Buffer.from("id:0123,event:UP,light:32\r\n")).then(comm.sendMsgs).catch(console.error);
  }
  fun();
}*/
