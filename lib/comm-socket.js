/**
 * @file comm.js
 * @brief Socket.io communication functions for gateway.js
 * @author Vili Pelttari
 */
const io = require('socket.io-client');
const socket = io.connect(gateway.socket.host, gateway.socket.options);
const moment = require("moment");

let comm = {};

let receiveCounter = 0; // perhaps not neccessary

send = comm.send = (topic, msg) => {
  return new Promise(resolve => {
    let option = {};
    if (gateway.debugMode) console.log(topic, JSON.stringify(msg));
    socket.emit(topic, JSON.stringify(msg));
    resolve();
  });
}

sendMsgs = comm.sendMsgs = (msg) => {
  for (const topic of gateway.topics) {
    if (msg[topic] && topic == "event") {
      let m = {}, labels = ["eat", "exercise", "pet"], n = {};
      for (let k = 0; k < 3; k++) {
        if (msg[topic].tamaActions[k] == 0)
          continue;
        m = {
          "sensortagID": msg[topic].sensortagID,
          //"timeStamp": moment().utc().toJSON(), 
          "event": labels[k],
          "increasedBy": msg[topic].tamaActions[k]
        };
        n = {
          "sensortagID": msg[topic].sensortagID,
          "event": labels[k],
          "timeStamp": moment().utc().toJSON()
        };
        send("event", n);
        send("tamagotchiUpdate", m);
      }

    } else if (msg[topic]) {
      if (!msg[topic].timeStamp) msg[topic].timeStamp = moment().utc().toJSON();
      send(topic, msg[topic]);
    }
  }
}

//let ttl = 0, stime = 0; // perhaps not neccessary

startComm = comm.startComm = () => {
  socket.on("connect_failed", () => {
    console.log("Connection to Backend server failed!");
  });

  socket.on("connect", () => {
    console.log("Connected to Backend server.");
    //ttl = stime = 0; // neccessary?
  });

  socket.on("tamagotchiNotification", (event) => {
    /*receiveCounter++;
    if (Date.now() - gateway.connectedAddresses[rxDict.sensortagID] > gateway.connectedAddressTimeout || !gateway.connectedAddresses[rxDict.sensortagID]) return;
    if (receiveCounter >= 20) {
      let now = Date.now();
      receiveCounter = 0;
      gateway.connectedAddresses = Object.assign({}, ...
        Object.entries(gateway.connectedAddresses).filter(([k, v]) => now - v >
          gateway.connectedAddressTimeout).map(([k, v]) => ({[k]: v}))
      );
    }*/
    console.log(event);
  });

  socket.on("error", err => {
    console.log("Socket reported a generic error!");
  });
}

end = comm.end = (reason) => {
  process.exit();
}

module.exports = comm;
