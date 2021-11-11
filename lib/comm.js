/**
 * @file comm.js
 * @brief MQTT communication functions for the gateway program
 * @author Vili Pelttari
 */
const mqtt = require("mqtt");
const gateway = require("../config");
const uart = require("./uart");
const util = require("./util");
const moment = require("moment");
const mqclient = mqtt.connect(gateway.mqtt.host, gateway.mqtt.options);

let comm = {};

let receiveCounter = 0;

/**
 * @brief Publish an MQTTS packet to the broker specified in 'mqclient'
 * @param topic The topic where this message should be sent to
 * @param msg Object representing the message to send
 * @return General resolve promise for running code after the transaction
 *
 * All modification to messages and topics should be made in config.js.
 */
send = comm.send = (topic, msg) => {
  return new Promise(resolve => {
    //console.log("Sending", JSON.stringify(msg), "on", topic);
    let options = {};
    mqclient.publish(topic, JSON.stringify(msg), options, err=>{
      if (err)
        console.error("Could not publish message to MQTT broker:", err.message);
    });
    resolve();
  });
}

/**
 * @brief Send messages to all topics in msg
 * @param msg A dictionary of topics, with dictionary values representing the message to be sent to
 * this topic
 */
sendMsgs = comm.sendMsgs = (msg) => {
  for (const topic of gateway.topics) {
    if (msg[topic]) {
      if (!msg[topic].timeStamp) msg[topic].timeStamp = moment().utc().toJSON();
      send(topic, msg[topic]);
    }
  }
}

let ttl = 0, stime = 0;

/**
 * @brief Start the MQTT
 */
startComm = comm.startComm = () => {
  /* Connection event handler. Subscribes to topics. Connection is automatically re-established after
   * connection loss
   */
  mqclient.on("connect", () => {
    console.log("Connected to MQTT Broker");
    ttl = stime = 0;
    mqclient.subscribe("game"); // subscribe to topic 'game'
  });

  /* Message event handler. Comprehends commands and other messages aimed at this gateway.
   *
   * Currently used for sending messages from the broker to connected SensorTag. These messages are
   * on topic 'game', and contain key-value pairs 'sensortagID': ID of SensorTag in question,
   * 'wall': character hit the wall, 'villain': character hit the villain.
   */
  mqclient.on("message", (topic, msg) => {
    try {
      rxDict = JSON.parse(msg.toString());
    } catch(e) {
      util.showMsg("error", "Bad input JSON string received via MQTT: " + msg.toString());
      return;
    }
    // Note the addresses attached to this gateway, so the same message will not be sent to
    // multiple gateways:
    if (topic == 'game' && rxDict.sensortagID) {
      receiveCounter++;
      if (Date.now() - gateway.connectedAddresses[rxDict.sensortagID] >
        gateway.connectedAddressTimeout || !gateway.connectedAddresses[rxDict.sensortagID]) return;
      if (receiveCounter >= 20) { // remove old entries
        let now = Date.now();
        receiveCounter = 0;
        gateway.connectedAddresses = Object.assign({}, ...
          Object.entries(gateway.connectedAddresses).filter(([k, v]) => now - v >
            gateway.connectedAddressTimeout).map(([k, v]) => ({[k]: v}))
        );
      }
    }
    if (topic == "game") {
      if ("sensortagID" in rxDict && rxDict.wall) {
        uart.uartWrite({addr: "ffff", str: rxDict.sensortagID.replace(/^0+/, '') + ",LOST GAME"});
      } else if ("sensortagID" in rxDict && rxDict.villain) {
        uart.uartWrite({addr: "ffff", str: rxDict.sensortagID.replace(/^0+/, '') + ",WIN"});
      }
    }
  });

  /* Connection error handler. Triggered every time an error occurs. Automatic reconnection attempts
   * also trigger it and the ttl--stime logic is to limit repeated error messages.
   *
   * This can be muted using '.mute' or the muteConnectionError constant in config.js.
   */
  mqclient.on("error", err => {
    if (err.code == "ECONNREFUSED") {
      if (ttl > 0) {ttl--; return;}
      if (!gateway.muteConnectionError)
        console.log("Broker unreachable:", err.message);
      ttl = stime = (stime < 50 ? stime+2 : 50);
    }
    else console.log(err);
  });
}

/**
 * @brief End the MQTT connection
 * @param reason Reason for ending
 */
end = comm.end = (reason) => {
  mqclient.unsubscribe("commands");
  mqclient.end(true, {reasonCode: 1, options: {reasonString: reason}}, process.exit);
}

module.exports = comm;
