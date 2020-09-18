/**
 * @file gateway.js
 * @brief UART 2-way communication handler for a ServerTag on JTKJ
 * @author Vili Pelttari
 * @version 1.1.4
 * @date 12.08.2020
 *
 * Dependencies (npm):
 *    serialport
 *    mqtt
 *
 * Capabilities:
 *    - 2-way UART communication with a SensorTag. Receive messages, send messages, possible status
 *    queries
 *    - Should automatically find the right ServerTag
 *    - Sends MQTTS packets about the current events (see function 'send')
 *    - Receives JSON data over MQTTS subscription (send messages to SensorTags, control Gateway if
 *    implemented)
 *    - Nice terminal interface
 *
 * Usage: Plug in a SensorTag via USB and run this file in powershell or similar with node.js.
 *
 * Pro tip: If there is someone spamming the ServerTag, first run the program, then plug in the
 * ServerTag. Wait for the reception to stop after a few connection tries, as in the red light
 * stops flashing and the 'Tag appears to have halted. Then send a message (type something and
 * press enter) and it should work perfectly. If not, try again in a Faraday cage.
 */
const
  ByteLength = require("@serialport/parser-byte-length");
  portFinder = require("./portFinder");
  SerialPort = require("serialport");
    readline = require("readline");
     gateway = require("./config");
      moment = require("moment");
        mqtt = require("mqtt");
          fs = require("fs");
const mqclient = mqtt.connect(gateway.mqtt.host, gateway.mqtt.options); // TODO does this do TLS?

let port; // the serial port after it has been found and connected to

/* Data transfer protocol over 6LoWPAN from SensorTags to the SensorTag acting as server:
 *
 * The 6LoWPAN message will be a byte array, with the 'data identifier' byte(s) in the beginning:
 *
 *    <ID>[[ID], ...]<MSG PART 1>[[MSG PART 2], ...]
 *
 * Currently, ID has a variable length. As ID is represented in bytes, each ID byte has 7 different
 * data identifier bits and 1 'extension byte follows' bit.
 *                       76543210
 *    ID byte structure: eddddddd
 *    in standard left-MSB, where
 *        e: 'extension byte follows' flag. If e=1 in first byte and e=0 in second byte, ID is 2 bytes long
 *        d: data identifier flag: 1 if the datum corresponding to the position is given in this message
 *
 * MSG PART is usually little-endian encoded because of SensorTag endianness. NOTE: MSG PARTs should
 * be in the same order as in data identifier bytes (ID) to be correctly labeled.
 *
 * When this message is transferred over UART, the sender address is added to the beginning, giving
 * the message we read in this program:
 *    
 *    <addr (2 bytes)><ID (1 byte)>[[ID], ...]<MSG PART 1>[[MSG PART 2], ...]
 */

let mask = validationMask();
let range = parseArgv();
/**
 * @brief Unwraps the data in the received UART packet. Data format is given in the list
 *        'gateway.dataDescr'
 * @param data The received UART data. A Buffer, read-only
 * @return A dictionary with keys sender and msg where msg is the sent data, unwrapped according to
 * 'gateway.dataDescr' and sender is the sender
 */
function unwrap(data) {
  let parts = [], pos = 2, uses, descr, error = false;
  let addr = ("0000" + data.readUInt16LE().toString(16)).slice(-4);
  if (range[2] && (range[0] > parseInt(addr) || parseInt(addr) < range[1])) return NaN;
  do ; while (data[++pos-1]&0x80); // inc pos while extend bit is on
  descr = data.slice(2, pos); // descr bytes start at index 2
  for (const item of gateway.dataDescr) {
    if (item.cmp(descr)) {
      try {
        parts.push([item.name, item.fun(data.slice(pos))]);
        uses = item.uses(data.slice(pos));
      } catch(e) {
        console.log("Unwrap error:", e.message);
        error = true;
      }
      pos += uses;
      if (pos >= data.length || uses == -1) break;
    }
    // if the data description doesn't match possible values, send an error with the senderAddr
    if (error || descr.length > mask.length) {// || descr.findIndex((d, i) => (d^mask[i])&d) != -1) {
      console.log("Faults encountered in received message!");
      console.log(error, descr, descr.length, mask.length, descr.findIndex((d, i) => (d^mask[i])&d));
      parts.push(["error", "Faulty data description"]);
      return {sender: addr, msg: parts};
    }
  }
  return {sender: addr, msg: parts};
}

/**
 * @brief Assumes binary gateway.dataDescr comparisons and builds a mask of all possible 'on' bits. This
 *        can be used to check for valid messages
 * @return The mask of possible 'on' bits in validation byte
 */
function validationMask() {
  let mask = [], position = [], found;
  while (mask.push(0) && position.push(1)) {
    found = false;
    for (let i = 0; i < 8; ++i) {
      for (const item of gateway.dataDescr) {
        if (item.cmp(position)) {
          mask[mask.length-1] |= position[position.length-1];
          found = true;
        }
      }
      position[position.length-1] <<= 1;
    }
    if (!found) return mask.slice(0, mask.length - 1);
  }
}

/**
 * @brief Parse vector of command line arguments for accepted senderAddr range
 * @return [lower bound, upper bound, checkRange]
 */
function parseArgv() {
  let i = process.argv.indexOf("-r")
  let range;
  if (i > -1 && process.argv.length > i+1) {
    range = process.argv[i+1].split(":")
    range[0] = parseInt(range[0])
    range[1] = parseInt(range[1])
    range[2] = true;
  } else return [0, 9999, false]
  return range
}

/**
 * @brief Writes TXLENGTH bytes to the open serial port
 * @param msg Dictionary describing what to send. 'str' is a necessary field. If 'addr' is
 *        specified, ServerTag will send an 6LoWPAN message to the provided address
 *          -str:  Message text (converted to ascii in this function, to prevent buffer problems)
 *          -addr: Receiver address as a string of four hex characters ('ffff' is broadcast)
 */
function uartWrite(msg, publish=true) {
  let txBuf = Buffer.alloc(gateway.uart.txlength);
  if ("addr" in msg) {
    txBuf.hexWrite(msg.addr);
    txBuf.asciiWrite(msg.str, 2);
  } else txBuf.asciiWrite(msg.str);

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
    parser = port.pipe(new ByteLength({length: gateway.uart.rxlength}));
  } catch(e) {
    showMsg("error", "Error opening port parser: " + e.message);
    return;
  }

  port.on("close", function(err) { // disconnection detection is slow
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
    }, 500);
    return;
  });

  let last = [], now = [], clients = [], starts = [], errors = [], errsum = 0, startsum=0, msgsum;
  port.on("open", function() {
    let dict = [], topic = "", index, text, avgs;
    showMsg("info", "UART connection opened.");
    setTimeout(sendChallenge, 1000);
    parser.on("data", function(data) {
      if (!responded && parseChallenge(data)) return;
      // read the data
      dict = ["msg", unwrap(data)];
      //console.log(JSON.stringify(dict));
      if (!dict[1]) return; // don't send messages that didn't belong to this gateway

      text = dict[1].msg.find(x => x[0] == 'text');
      if (text != undefined && !isNaN(Number(text[1]))) {
        index = clients.indexOf(dict[1].sender);
        if (index == -1) {
          clients.push(dict[1].sender);
          last.push(null);
          now.push(Number(text[1]));
          starts.push(Number(text[1]));
          errors.push(0);
          startsum += Number(text[1]);
          console.log(dict[1].sender, String.fromCharCode(96 + clients.length), "started stress testing!");
        } else {
          last[index] = now[index];
          now[index] = Number(text[1]);
          if (last[index] + 1 != now[index]) {
            avgs = "";
            errors[index] += now[index] - last[index] - 1;
            errsum += now[index] - last[index] - 1;
            msgsum = now.reduce((s, x) => s+x);
            //console.log(dict[1].sender, "made an error:", now[index] - last[index] - 1);
            avgs += (errsum*100/(msgsum - startsum + clients.length)).toFixed(1) + "% total, ";
            for (const i of Array(clients.length).keys()) {
              avgs += String.fromCharCode(97 + i) + (errors[i]*100/(now[i]-starts[i]+1)).toFixed(1) + "%  ";
            }
            console.log(avgs);
          }
        }
        return;
      }

      //dict[0] = "msg";
      send(dict);
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
  if (data[0] == data[1] && data[1] == 0xfe && data[2] == 1) {
    str = data.slice(3).toString().replace(/\0*$/g, '');
    showMsg("info", "Challenge response: " + str);
    portFinder.clearBlacklist();
    responded = true;
    return true;
  }
  return false;
}

/**
 * @brief Send a challenge to the newly connected ServerTag and start a timeout for the function
 *        that will disconnect it if it didn't respond correctly
 */
function sendChallenge() {
  uartWrite({str: "\x00\x00\x01Identify"}, false);
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
 * @brief Send a message on all interfaces (the console and the MQTTS broker)
 * @param type Type of the message
 * @param str The message
 * @return A resolve promise for knowing when the MQTTS publish has been completed.
 */
function showMsg(type, str) {
  return new Promise(resolve => {
    /*if (type == "error")
      console.error(str);
    else*/
    console.log(str);
    send([type, str]).then(resolve);
  });
}

/**
 * @brief Publish an MQTTS packet to the broker specified in 'mqclient'
 * @param msg A list [topic, obj] representing the message to send. For contents, see below
 * @return General resolve promise for running code after the transaction
 *
 * The first element in msg will be one of ["info", "error", "msg"].
 *    info:  Gateway status changes and general information
 *    error: Gateway error that might be good to know about
 *    msg:   A UART message was received and the obj contains SensorTag data
 *      - message contents in 'gateway.dataDescr' TBD
 */
function send(msg) {
  return new Promise(resolve => {
    let topic = msg[0];
    let message = {};
    if (typeof(msg[1]) == "object") { // TODO add the two message types
      message["sender"] = msg[1].sender;
      for (const part of msg[1].msg) {
        if (part[0] == "dir") continue;
        message[part[0]] = part[1];
      }
    } else {
      message["msg"] = msg[1];
    }
    message["timeStamp"] = moment().format();

    console.log(JSON.stringify(message));
    let options = {};
    mqclient.publish(topic, JSON.stringify(message), options, err=>{
      if (err)
        console.error("Could not publish message to MQTT broker:", err.message);
    });
    resolve();
  });
}

let ttl = 0, stime = 0;
/* Connection event handler. Subscribes to topics. Connection is automatically re-established after
 * connection loss
 */
mqclient.on("connect", ()=>{
  console.log("Connected to MQTT Broker");
  ttl = stime = 0;
  mqclient.subscribe("commands");
});

/* Message event handler. Comprehends commands and other messages aimed at this gateway.
 *
 * Supported keys in received dictionary:
 *    -send: Send a 6LoWPAN message
 *        -addr: Receiver address
 *        -str:  Message text
 */
mqclient.on("message", (topic, msg)=>{
  try {
    rxDict = JSON.parse(msg.toString());
  } catch(e) {
    showMsg("error", "Bad input JSON string received");
    return;
  }
  if ("send" in rxDict) {
    if (port.isOpen) {
      uartWrite(rxDict.send);
      // TODO maybe reply that it was written ok? Extra ack?
    }
  }
});

/* Connection error handler. Triggered every time an error occurs. Automatic reconnection attempts
* also trigger it and the ttl--stime logic is to limit repeated error messages.
 */
mqclient.on("error", err => {
  if (err.code == "ECONNREFUSED") {
    if (ttl > 0) {ttl--; return;}
    //console.log("Broker unreachable:", err.message);
    ttl = stime = (stime < 50 ? stime+2 : 50);
  }
  else console.log(err);
});

// readline interface for reading console input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

/**
 * @brief Handles the console/terminal input from user when the ServerTag is connected
 * @param line The line read from stdin
 */
function consoleHandler(line) {
  if (line[0] == '.') {
    if (line == ".reconnect") {
      port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}});
      console.log("\n");
      return;
    } else console.log("Unknown command");
  } else if (/[0-9a-f]{4}#.+/i.test(line)) {
    let parts = line.split(/#(.+)/, 2);
    uartWrite({addr: parts[0], str: parts[1]});
  } else if (line.length > 0) {
    uartWrite({addr: "ffff", str: line});
  }
}

// SIGINT handler
process.once('SIGINT', function(code) {
  showMsg("info", "Gateway encountered SIGINT. Exiting.").then(()=>{
    mqclient.unsubscribe("commands");
    mqclient.end(true, {reasonCode: 1, options: {reasonString: "SIGINT"}}, process.exit);
  });
});
// SIGTERM handler
process.once('SIGTERM', function(code) {
  showMsg("info", "Gateway encountered SIGTERM. Exiting.").then(()=>{
    mqclient.unsubscribe("commands");
    mqclient.end(true, {reasonCode: 1, options: {reasonString: "SIGTERM"}}, process.exit);
  });
});

// Start program
process.stdout.write("\033[s"); // save cursor position
portFinder.init(rl, showMsg, send, consoleHandler);
portFinder.findPorts(main);
