/**
 * @file config.js
 * @brief Configuration for gateway.js
 * @author Vili Pelttari
 */
const util = require("./lib/util.js");
const fs = require("fs");
var gateway = {};

gateway.mqtt = {};
gateway.mqtt.host = 'mqtt://localhost:10311';
gateway.mqtt.options = {
  ca: fs.readFileSync('certs/ca.crt'),
  key: fs.readFileSync('certs/mqttClientKey.key'),
  cert: fs.readFileSync('certs/mqttClientKey.crt'),
  rejectUnauthorized: false
};

// XXX: There are gateway server related values at the bottom
gateway.uart = {};
gateway.uart.txlength = 17;
gateway.uart.baudRate = 9600;

// UART message parser type
gateway.uart.pipe = "delimiter";
//gateway.uart.pipe = "length";

// Delimiter parser
gateway.uart.delim = "\x00";

// Length parser
gateway.uart.rxlength = 82;

gateway.ports = {};
gateway.ports.autofind = true;
gateway.ports.maxTries = 5;

// Mutes the 'Broker unreachable' warning if it is spammed
gateway.muteConnectionError = false;

// Time after which connected addresses aren't remembered, in milliseconds.
// Used for limiting reply messages from being broadcast from multiple gateways
gateway.connectedAddressTimeout = 10000;

gateway.topics = [ // All possible SensorTag data topics. Dummy topics are used for gateway commands
  "event",
  "sensordata",
  "commands" // dummy topic for internal commands
];
/**
 * Different data fields to be received via UART.
 *
 * Element description: A dictionary with values
 *  shortName - name in received UART message
 *  nameInDB  - name to be used when sending the property via MQTT
 *  topics    - the MQTT topics where this property can be sent to, an array
 *  forceSend - false or undefined. False when this property alone doesn't cause a MQTT message to
 *              be sent. Undefined otherwise
 *  fun       - A Promise-type function with one argument, used to parse the data from the UART
 *              message. Argument is the data belonging to this property ({shortName}:{argument}).
 *              Resolve gives the processed data on success, and reject message is shown in terminal on fail.
 */
gateway.dataTypes = [{
    shortName: "time",
    nameInDB: "timeStamp",
    topics: ["event", "sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => { // d is String
      let a = Number.parseInt(d);
      if (isNaN(a)) reject("Error: Non-numeric timestamp: " + d);
      resolve(a);
    }),
  }, { // ID is special. It will be picked in the readDataTokens and forwarded to other functions. TODO experiment if this can be relaxed
    shortName: "id",
    nameInDB: "sensortagID",
    topics: ["event"],
    forceSend: false, // Reception doesn't warrant a send on the associated topics
    fun: d => new Promise((resolve, reject) => {
      if (!isNaN(Number.parseInt(d, 16)) && d.length <= 4) {
        resolve(d);
      } else reject("Error: SensorTag ID has to be 4 hex digits: " + d);
    }),
  }, {
    shortName: "ping",
    nameInDB: "ping",
    topics: ["commands"], // dummy topic
    forceSend: false, // don't send gateway-related data to MQTT
    fun: d => new Promise((resolve, reject) => {
      resolve("pong");
    }),
  }, {
    shortName: "session",
    nameInDB: "session",
    topics: ["commands"], // dummy topic
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      if (["start", "end"].includes(d.trim())) resolve(d.trim() == "start");
      else reject("Error: Session instruction not recognized: " + d);
    }),
  },



  {
    shortName: "event",
    nameInDB: "movement",
    topics: ["event"],
    // forceSend not set to false (undefined), meaning this will force a send
    fun: d => new Promise((resolve, reject) => {
      if (["UP", "DOWN", "LEFT", "RIGHT"].includes(d.trim())) resolve(d.trim());
      else reject("Error: Event name not recognized: " + d);
    }),
  },


  {
    shortName: "temp",
    nameInDB: "temperature",
    topics: ["sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric temperature: " + d);
      resolve(a);
    }),
  }, {
    shortName: "humid",
    nameInDB: "humidity",
    topics: ["sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric humidity: " + d);
      resolve(a);
    }),
  }, {
    shortName: "press",
    nameInDB: "pressure",
    topics: ["sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric pressure: " + d);
      resolve(a);
    }),
  }, {
    shortName: "light",
    nameInDB: "lightIntensity",
    topics: ["sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric light intensity: " + d);
      resolve(a);
    }),
  }, {
    shortName: "ax",
    nameInDB: "ax", // ax is used as a special variable in the unwrap function
    topics: ["sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric acceleration (x): " + d);
      resolve(a);
    }),
  }, {
    shortName: "ay",
    nameInDB: "ay",
    topics: ["sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric acceleration (y): " + d);
      resolve(a);
    }),
  }, {
    shortName: "az",
    nameInDB: "az",
    topics: ["sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric acceleration (z): " + d);
      resolve(a);
    }),
  }, {
    shortName: "gx",
    nameInDB: "gx",
    topics: ["sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric gyroscope (x): " + d);
      resolve(a);
    }),
  }, {
    shortName: "gy",
    nameInDB: "gy",
    topics: ["sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric gyroscope (y): " + d);
      resolve(a);
    }),
  }, {
    shortName: "gz",
    nameInDB: "gz",
    topics: ["sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric gyroscope (z): " + d);
      resolve(a);
    }),
  }
];

// Server settings:

gateway.server = {};
gateway.server.baudRate = 57600;
gateway.server.pipe = "delimiter";
gateway.server.delim = Buffer.of(242);
gateway.isServer = false;

// Interval between checking if the ServerTag has crashed, in milliseconds
gateway.heartbeatInterval = 15000;

gateway.debugMode = false;

// TODO maybe disable terminal clearing in server mode? It would function as a log

// Parse command line arguments that change values defined here
util.parseArgv(gateway);

// Global variables
gateway.connectedAddresses = {};

module.exports = gateway;
