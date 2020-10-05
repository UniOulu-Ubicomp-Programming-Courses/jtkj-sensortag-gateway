var gateway = {};

gateway.mqtt = {};
// real port is 1883, test server on 3003
gateway.mqtt.host = 'mqtt://localhost:1883';
gateway.mqtt.options = {
    //ca: fs.readFileSync('certs/root/root.crt'), // XXX a custom certificate file
  // XXX client certificates for MQTTS (TLS version of MQTT):
    //key: fs.readFileSync('certs/client/client.key'),
    //cert: fs.readFileSync('certs/client/client.crt'),
};
gateway.uart = {};
gateway.uart.rxlength = 32;
gateway.uart.txlength = 17;
gateway.uart.baudRate = 57600;

gateway.topics = [ // for SensorTag data topics
  "events",
  "sensordata",
];
gateway.dataTypes = [{
    shortName: "time",
    nameInDB: "timeDONTSEND",
    topics: ["events", "sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => { // d is String
      let a = Number.parseInt(d);
      if (isNaN(a)) reject("Error: Non-numeric timestamp: " + d);
      resolve(a);
    }),
  }, {
    shortName: "id",
    nameInDB: "sensortagID",
    topics: ["events", "sensordata"],
    forceSend: false,
    fun: d => new Promise((resolve, reject) => {
      if (!isNaN(Number.parseInt(d, 16)) && d.length <= 4) {
        resolve(d);
      } else reject("Error: SensorTag ID has to be 4 hex digits: " + d);
    }),
  }, {
    shortName: "event",
    nameInDB: "movement",
    topics: ["events"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      if (["UP", "DOWN", "LEFT", "RIGHT"].includes(d)) resolve(d);
      else reject("Error: Event name not recognized: " + d);
    }),
  }, {
    shortName: "temp",
    nameInDB: "temperature",
    topics: ["sensordata"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric temperature: " + d);
      resolve(a);
    }),
  }, {
    shortName: "humid",
    nameInDB: "humidity",
    topics: ["sensordata"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric humidity: " + d);
      resolve(a);
    }),
  }, {
    shortName: "press",
    nameInDB: "pressure",
    topics: ["sensordata"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric pressure: " + d);
      resolve(a);
    }),
  }, {
    shortName: "light",
    nameInDB: "lightIntensity",
    topics: ["sensordata"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric light intensity: " + d);
      resolve(a);
    }),
  }, {
    shortName: "accx",
    nameInDB: "accx",
    topics: ["sensordata"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric acceleration (x): " + d);
      resolve(a);
    }),
  }, {
    shortName: "accy",
    nameInDB: "accy",
    topics: ["sensordata"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric acceleration (y): " + d);
      resolve(a);
    }),
  }, {
    shortName: "accz",
    nameInDB: "accz",
    topics: ["sensordata"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric acceleration (z): " + d);
      resolve(a);
    }),
  }, {
    shortName: "gyrox",
    nameInDB: "gyrox",
    topics: ["sensordata"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric gyroscope (x): " + d);
      resolve(a);
    }),
  }, {
    shortName: "gyroy",
    nameInDB: "gyroy",
    topics: ["sensordata"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric gyroscope (y): " + d);
      resolve(a);
    }),
  }, {
    shortName: "gyroz",
    nameInDB: "gyroz",
    topics: ["sensordata"],
    forceSend: true,
    fun: d => new Promise((resolve, reject) => {
      let a = Number.parseFloat(d);
      if (isNaN(a)) reject("Error: Non-numeric gyroscope (z): " + d);
      resolve(a);
    }),
  }
];

module.exports = gateway;