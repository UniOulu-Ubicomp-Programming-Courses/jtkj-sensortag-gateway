/**
 * @file comm.js
 * @brief Socket.io communication functions for gateway program
 * @author Vili Pelttari
 */
const io = require('socket.io-client');
let socket;
if (!gateway.offline)
  socket = io.connect(gateway.socket.host, gateway.socket.options);
const moment = require("moment");
const util = require("./util");
const uart = require("./uart");

let comm = {};

//let receiveCounter = 0; // perhaps not neccessary

send = comm.send = (topic, msg) => {
  return new Promise(resolve => {
    let option = {};
    if (gateway.debugMode) util.showMsg("debug", topic + " " + JSON.stringify(msg));
    socket.emit(topic, JSON.stringify(msg));
    resolve();
  });
}

sendMsgs = comm.sendMsgs = (msg) => {
  if (gateway.offline) return;
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
  let recencyTable = {};
  socket.on("connect_failed", () => {
    util.rl.setPrompt('\033[31m$\033[0m ');
    util.showMsg("error", "Connection to Backend server failed!");
  });

  socket.on("connect", () => {
    util.rl.setPrompt('\033[0m$ ');
    util.showMsg("info", "Connected to Backend server.");
    //ttl = stime = 0; // neccessary?
  });

  socket.on("disconnect", () => {
    util.rl.setPrompt('\033[31m$\033[0m ');
    util.showMsg("error", "Disconnected from Backend server!");
  });

  socket.on("tamagotchiNotification", (event) => {
    /* This code would check if the target address has been sending messages to this gateway */
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
    /* sensortagID, notifications */
    if (!recencyTable.addr) recencyTable.addr = {time: Date.now(), num: 1};
    else recencyTable.addr = {
      time: Date.now(),
      num: (Date.now() - recencyTable.addr.time > 2000) ? 1 : recencyTable.addr.num + 1
    };
    if (recencyTable.addr.num < 6)
      uart.uartWrite({addr: "ffff", str: event.sensortagID.replace(/^0+/, '') + ",BEEP:" + event.notifications.join(";")});
  });

  socket.on("error", err => {
    util.showMsg("error", "Socket reported a generic error!");
  });
}

end = comm.end = (reason) => {
  process.exit();
}

module.exports = comm;
