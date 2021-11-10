/**
 * @file comm.js
 * @brief Socket.io communication functions for interface.js
 * @author Vili Pelttari
 */
const io = require('socket.io-client');
let socket;
if (!interface.offline)
  socket = io.connect(interface.socket.host, interface.socket.options);
const moment = require("moment");
const util = require("./util");
const uart = require("./uart");

let comm = {};

//let receiveCounter = 0; // perhaps not neccessary

send = comm.send = (topic, msg) => {
  return new Promise(resolve => {
    let option = {};
    if (interface.debugMode) util.showMsg("debug", topic + " " + JSON.stringify(msg));
    socket.emit(topic, JSON.stringify(msg));
    resolve();
  });
}

sendMsgs = comm.sendMsgs = (msg) => {
  if (interface.offline) return;
  for (const topic of interface.topics) {
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
    util.showMsg("error", "Connection to Backend server failed!");
  });

  socket.on("connect", () => {
    util.showMsg("info", "Connected to Backend server.");
    //ttl = stime = 0; // neccessary?
  });

  socket.on("disconnect", () => {
    util.showMsg("error", "Disconnected from Backend server!");
  });

  socket.on("tamagotchiNotification", (event) => {
    /* This code would check if the target address has been sending messages to this interface */
    /*receiveCounter++;
    if (Date.now() - interface.connectedAddresses[rxDict.sensortagID] > interface.connectedAddressTimeout || !interface.connectedAddresses[rxDict.sensortagID]) return;
    if (receiveCounter >= 20) {
      let now = Date.now();
      receiveCounter = 0;
      interface.connectedAddresses = Object.assign({}, ...
        Object.entries(interface.connectedAddresses).filter(([k, v]) => now - v >
          interface.connectedAddressTimeout).map(([k, v]) => ({[k]: v}))
      );
    }*/
    /* sensortagID, notifications */
    uart.uartWrite({addr: "ffff", str: event.sensortagID.replace(/^0+/, '') + ",BEEP"}); /* + ":" + event.notifications});*/
  });

  socket.on("error", err => {
    util.showMsg("error", "Socket reported a generic error!");
  });
}

end = comm.end = (reason) => {
  process.exit();
}

module.exports = comm;
