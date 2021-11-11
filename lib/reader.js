const uart = require("./uart");
const gateway = require("../config");
const util = require("./util");
const moment = require("moment");
let reader = {};

let sessionData = {}; // sensor data is split into sessions, stored here
/**
 * @brief Read key-value pairs from received SensorTag message
 * @param data The SensorTag message: Buffer.from("id:XXXX,data1:CCCCCCCC,...") or in server use,
 * the id is given as two LE bytes in the beginning: Buffer.from("abdata1:CCCCCC,...") where ab is
 * the address id:6261.
 * @return Promise resolves with a list of dictionaries for each topic to be sent to backend. Rejects
 * with error messages
 */
unwrap = reader.unwrap = (data) => {
  // Decode data from escape characters
  data = util.decodeEscapedBuffer(data);
  return new Promise((resolve, reject) => {
    data = readDataToString(data);
    prefix = data[0]
    data = data[1]

    // Handle constant internal messaging
    if (data == "id:fefe,\x01HB") {
      let now = Date.now();
      if (gateway.heartbeatInterval*1.5 < now - uart.hbTime)
        util.showMsg("info", "Heartbeat: ServerTag reconnected.");
      uart.hbTime = now;
      resolve({});
      return;
    }

    // Display the data buffer with visible escape sequences for characters and no utf8 errors
    if (!gateway.isServer) {
      if (data[0] === "|") {
        util.showMsg("recv", data);
        return;
      } else {
        util.showMsg("recv", new Date().toTimeString().split(" ")[0] + "> " + JSON.stringify(data).slice(1, -1));
      }
    } else {
      if (data[8] === "|") {
        util.showMsg("recv", data.slice(9));
        return;
      } else {
        util.showMsg("recv", new Date().toTimeString().split(" ")[0] + " " + prefix + "> " + JSON.stringify(data).slice(9, -1)); // slice off id:XXXX
      }
    }

    readDataTokens(data).then(([addr, sends, resultDicts]) => {
      gateway.connectedAddresses[addr] = Date.now(); // Save the time when this address sent something, for replies

      // Add together values from multiple commands, and output a single value
      if (resultDicts.tamaActions) {
        let sum = Object.values(resultDicts.tamaActions).reduce((a,b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]]);
        resultDicts["event"]["tamaActions"] = sum;
        sends.push("event");
      }

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
        // if the sessionData for this addr is too large, abort adding more rows
        if (sessionData[addr].timeStamp.length >= gateway.maxSessionRows) {
          reject("Error: Sensor data session is full (" + gateway.maxSessionRows + " rows).");
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

      // Reply to ping with pong before the session end is handled:
      // This allows spamming session commands over an unstable connection, and definitely knowing
      // that the command went through
      if (resultDicts.commands && resultDicts.commands.ping) { // Ping can likely be used as a confirmation of correct message
        uartWrite({addr: addr, str: resultDicts.commands.ping});
      }

      // Session end
      if (resultDicts.commands && resultDicts.commands.session == false) {
        // Session end logic
        // Check if active session exists
        if (addr in sessionData) {
          if (sessionData[addr].timeStamp.length == 0) { // Don't send an empty session
            //delete sessionData[addr]; // Remove empty session
            reject("Error: The session was empty. It will not be sent.");
            return;
          }
          delete sessionData[addr].sessionTimeStamp;
          util.showMsg("info", "Session from " + addr + " ended, sending " + sessionData[addr].ax.length + " rows of data.")
          comm.send("sensordata", sessionData[addr]);
          delete sessionData[addr]; // erase data after send
        } else {
          reject("Error: No session was started. Session data send prevented.");
          return;
        }
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
 * @return The buffer as a String within a 2-entry long array. First entry will be the text before
 * the displayed '>' character, and the second entry is the received message. In server use, the
 * sender id will be prepended to the received message as 'id:xxxx,'
 */
function readDataToString(data) {
  // If not server, the Sensortag ID should be in the data -> no alterations
  if (!gateway.isServer) return ["", data.toString('binary')];
  // if in server use, the senderAddr is given in two bytes in the beginning of the message
  addr = ("0000" + data.readUInt16LE().toString(16)).slice(-4);
  return [addr, "id:" + addr + "," + data.slice(2).toString('binary')];
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
      pair = token.split(":");
      pair = [pair[0], pair.slice(1).join(":")].map(d => d.trim()); // pair = [name, value]
      dtype = gateway.dataTypes.find(type => type.shortName == pair[0]);
      if (dtype != undefined) { // if name is found in defined data types
        // Execute the dtype decode function with the parameter value if it exists
        await dtype.fun(pair.length == 1 ? undefined : pair[1]).then(
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

module.exports = reader;
