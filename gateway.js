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
      moment = require("moment");
        comm = require("./lib/comm");
        Fifo = require("queue-fifo");
        util = require("./lib/util");
          fs = require("fs");

let port; // the serial port after it has been found and connected to

let hbTime = 0; // last time the heartbeat was responded to
let responded = false; // communicate if the challenge-response has been cleared
let uartSendBuffer = new Fifo(); // space out outgoing UART messages in time
let sessionData = {}; // sensor data is split into sessions, stored here
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
  port = new SerialPort(path, {baudRate: gateway.uart.baudRate}, function(err) {
    if (err === null) return;
    showMsg("error", "Bad port: " + err.message);
    portFinder.findPorts().then(main);
    return; // leave portfinder to searching and exit main meanwhile
  });

  try {
    if (gateway.uart.pipe == "length"){
      parser = port.pipe(new ByteLength({length: gateway.uart.rxlength}));
    } else {
      parser = port.pipe(new Delimiter({delimiter: gateway.uart.delim}));
    }
  } catch(e) {
    showMsg("error", "Error opening port parser: " + e.message);
    return;
  }

  if (gateway.isServer) {
    hbTime = Date.now();
    heartbeatService = setInterval(heartbeat, gateway.heartbeatInterval); // check ServerTag every 15 seconds
  }

  port.on("close", (err) => { // disconnection detection is slow on some devices
    if (err != null && err.disconnected) {
      showMsg("error", "The SensorTag server disconnected from USB! Please reconnect.");
    } else if (err != null) {
      showMsg("error", "Unencountered error with UART connection. Attempting to reconnect.");
    }
    setTimeout(() => {
      if (responded) {
        process.stdout.write("\033[2J\033[1H\033[s"); // clear console, move cursor to first line, save position
        responded = false;
      }
      if (gateway.isServer) clearInterval(heartbeatService);
      parser.destroy();
      portFinder.findPorts().then(main); // retry connection
      return; // leave portfinder to searching and exit main meanwhile
    }, 1500);
  });

  // Main functionality after connection is established:
  port.on("open", () => {
    let dict = [], topic = "";
    showMsg("info", "UART connection opened.");
    if (gateway.isServer) setTimeout(sendChallenge, 1000);
    else responded = true;
    parser.on("data", function(data) {
      if (!responded && !parseChallenge(data)) return;
      // read the data, send via MQTT on success and show errors in console on failure
      unwrap(data).then(comm.sendMsgs).catch(console.error);
    });
  });
}

/**
 * @brief Check and send the heartbeat query. Used to check if the ServerTag has crashed
 */
function heartbeat() {
  let now = Date.now();
  if (gateway.heartbeatInterval*1.5 < now - hbTime && now - hbTime < gateway.heartbeatInterval*2.5) {
    showMsg("error", "Error: Heartbeat: The ServerTag has possibly crashed!");
  }
  uartWrite({str: "\x00\x00\x01HB", internal: true}, false);
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
 * @param data The SensorTag message: Buffer.from("id:XXXX,data1:CCCCCCCC,...") or in server use,
 * the id is given as two LE bytes in the beginning: Buffer.from("abdata1:CCCCCC,...") where ab is
 * the address id:6261.
 * @return Promise resolves with a list of dictionaries for each topic to be sent via MQTT. Rejects
 * with error messages
 */
function unwrap(data) {
  // Decode data from escape characters
  data = util.decodeEscapedBuffer(data);
  return new Promise((resolve, reject) => {
    data = readDataToString(data);

    // Handle constant internal messaging
    if (data == "id:fefe,\x01HB") {
      let now = Date.now();
      if (gateway.heartbeatInterval*1.5 < now - hbTime)
        showMsg("info", "Heartbeat: ServerTag reconnected.");
      hbTime = now;
      resolve({});
      return;
    }

    console.log(">", data.trim()); // show parsed data in terminal

    readDataTokens(data).then(([addr, sends, resultDicts]) => {
      gateway.connectedAddresses[addr] = Date.now(); // Save the time when this address sent something, for replies

      // Session start
      if (resultDicts.commands && resultDicts.commands.session == true) {
        // Session start logic. Allow resetting the session buffer while a session is being
        // recorded.
        sessionData[addr] = makeDataEntry(addr);
      }

      // Add sensordata to the sessionData
      if (resultDicts["sensordata"]) {
        if (!(addr in sessionData)) {
          reject("Error: Sensor data received while no session has been started.");
          return;
        }
        // it is in sessionData, so we push each sensor into it
        for (label in sessionData[addr]) {
          if (label == "sensortagID") continue;
          if (label == "sessionTimeStamp") continue;
          if (label == "timeStamp" && !(label in resultDicts.sensordata)) {
            sessionData[addr].timeStamp.push(moment().utc().diff(sessionData[addr].sessionTimeStamp));
            continue;
          }
          if (label in resultDicts.sensordata) // fill sensor data into the session buffer
            sessionData[addr][label].push(resultDicts.sensordata[label]);
          else
            sessionData[addr][label].push(null);
        }
      }

      // Session end
      if (resultDicts.commands && resultDicts.commands.session == false) {
        // Session end logic
        // Check if active session exists
        if (addr in sessionData) {
          if (sessionData[addr].ax.length == 0) { // Don't send an empty session
            //delete sessionData[addr]; // Remove empty session
            reject("Error: The session was empty. It will not be sent.");
            return;
          }
          //sessionData[addr].sessionTimeStamp = sessionData[addr].sessionTimeStamp.toJSON();
          delete sessionData[addr].sessionTimeStamp;
          console.log("Session from", addr, "ended, sending", sessionData[addr].ax.length, "rows of data.")
          comm.send("sensordata", sessionData[addr]);
          delete sessionData[addr]; // erase data after send
        } else {
          reject("Error: No session was started. Session data send prevented.");
          return;
        }
      }

      // Reply to ping with pong
      if (resultDicts.commands && resultDicts.commands.ping) { // Ping can likely be used as a confirmation of correct message
        uartWrite({addr: addr, str: resultDicts.commands.ping});
      }
      
      for (const topic of gateway.topics)
        if (!sends.includes(topic)) delete resultDicts[topic];
      resolve(resultDicts);
    }, reject /* Pass tokenization errors forward */);
  });
}

/**
 * @brief Convert the Buffer to a String, including a key-value for the id if in server use
 * @param data Buffer received from UART. In server use, the first two bytes will be the sender
 * SensorTag's address, encoded in an unsigned Little-Endian short
 * @return The buffer as a String. In server use, the sender id will be prepended as 'id:xxxx,'
 */
function readDataToString(data) {
  // If not server, the Sensortag ID should be in the data -> no alterations
  if (!gateway.isServer) return data.toString();
  // if in server use, the senderAddr is given in two bytes in the beginning of the message
  addr = ("0000" + data.readUInt16LE().toString(16)).slice(-4);
  // represent the message in common form
  return "id:" + addr + "," + data.slice(2).toString();
}

/**
 * @brief Read tokens from UART received string into two data structures: the topics that will be sent to
 * the database, and the decoded items of data from each topic.
 * @param data String with key(-value) pairs defined in gateway.dataTypes:
 * "id:0025,event:UP,session:start,press:101325.61,ping"
 * @return Promise with resolving in the sender address, topics that will be sent to the database,
 * and the data inside these topics. The reject contains a string describing the error
 */
function readDataTokens(data) {
  let addr = null, sends = [], resultDicts = {}, pair, dtype;
  let tokens = data.split(",");
  return new Promise(async (resolve, reject) => {
    for (const token of tokens) { // iterate through tokens
      pair = token.split(":").map(d => d.trim()); // pair = [name, value]
      dtype = gateway.dataTypes.find(type => type.shortName == pair[0].replace(/\x00/g, ''));
      if (dtype != undefined) { // if name is found in defined data types
        // Execute the dtype decode function with the parameter value if it exists
        await dtype.fun(pair.length == 2 ? pair[1].replace(/\x00/g, '') : undefined).then(
          d => {
            for (const table of dtype.topics) {
              if (dtype.shortName == "id") addr = d; // get the addr for other uses
              if (dtype.forceSend != false && !sends.includes(table)) sends.push(table);
              if (!(table in resultDicts)) resultDicts[table] = {};
              resultDicts[table][dtype.nameInDB] = d; // add decoded data into table
            }
          }, reject /* pass error forward */);
      } else {
        // Couldn't find the name in the dataTypes. Find closest match and throw an error
        reject("Error: Unknown field label \"" + pair[0] + "\". Did you mean \"" +
          util.closestMatch(pair[0].toLowerCase(), gateway.dataTypes.map(d=>d.shortName)) + "\"?");
      }
    }
    if (!addr) reject("Error: No SensorTag ID given!");
    resolve([addr, sends, resultDicts]);
  });
}

/**
 * @brief Create a data entry for storing the session data
 * @param addr The SensorTag ID for which this data entry belongs
 * @return An empty data entry filled with the address and the session time stamp
 */
function makeDataEntry(addr) {
  return {
          sensortagID: addr,
          sessionTimeStamp: moment().utc(),
          temperature: [],
          humidity: [],
          pressure: [],
          lightIntensity: [],
          timeStamp: [],
          ax: [],
          ay: [],
          az: [],
          gx: [],
          gy: [],
          gz: []
        };
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
    uartWrite({internal: true, str: line});
  } else if (/[0-9a-f]{4}#.+/i.test(line)) { // check if the sensortag address is given in the beginning as 6261#message for sending "message" to id:ab
    let parts = line.split(/#(.+)/, 2);
    uartWrite({addr: parts[0], str: parts[1]});
  } else if (line.length > 0) { // gateway is server, so send all other data as broadcast messages
    uartWrite({addr: "ffff", str: line});
  }
}

/**
 * @brief Send an UART message. The message will be formed with the address, and added to a message
 * queue from which it will be sent by the uartSenderService
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
    txBuf.writeUInt16LE(Number.parseInt(addr, 16));
    txBuf.asciiWrite(msg.str, 2);
  } else {
    txBuf.asciiWrite(msg.str);
  }
  // Add to FIFO send queue
  uartSendBuffer.enqueue([txBuf, publish])
}

/**
 * @brief Send messages TXLENGTH bytes long from the UART send queue with time in between
 *
 * Monitors the UART send message queue and send messages from it with enough time in between
 * for the ServerTag to execute them properly.
 */
function uartSender() {
  if (uartSendBuffer.isEmpty() || !port) {
    return;
  }
  var [txBuf, publish] = uartSendBuffer.dequeue();
  var msg = txBuf.subarray(2).toString().replace(/\0/g, '');
  var addr = ("0000" + txBuf.readUInt16LE().toString(16)).slice(-4);
  port.write(txBuf, function(err) {
    if (err) {
      showMsg("error", "UART write error: " + err.message);
      // prevent spam by discarding the message
    } else if (publish && port.isOpen) {
      showMsg("info", "Sent '" + msg + "' to 0x" + addr);
    } else if (publish) {
      showMsg("error", "Sending aborted. SensorTag isn't connected.");
    }
  });
}
uartSenderService = setInterval(uartSender, 500);

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
  showMsg("info", "Gateway encountered SIGINT. Exiting.").then(() => {port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}}); comm.end("SIGINT")}).catch((err) => comm.end("SIGINT"));
});
// SIGTERM handler
process.once('SIGTERM', function(code) {
  showMsg("info", "Gateway encountered SIGTERM. Exiting.").then(() => {port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}}); comm.end("SIGTERM")}).catch((err) => comm.end("SIGTERM"));
});

// Initiate comm
comm.init(uartWrite);
// Start MQTT
comm.startMQTT();
// Start program
process.stdout.write("\033[s"); // save cursor position
portFinder.init(rl, showMsg, comm.send, consoleHandler);
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
