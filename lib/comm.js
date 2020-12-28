/**
 * @file comm.js
 * @brief MQTT communication functions for gateway.js
 * @author Vili Pelttari
 * @date 28.12.2020
 */
const mqtt = require("mqtt");
const gateway = require("../config");
const mqclient = mqtt.connect(gateway.mqtt.host, gateway.mqtt.options);

module.exports = {
  init: init,
  startMQTT: startMQTT,
  send: send,
  sendMsgs: sendMsgs,
  end: end
}

let uartWrite;

/**
 * @brief Initiate comm library. This adds UART writing functionality to it.
 * @param writeToUART The function that can send data via UART
 */
function init(writeToUART) {
  uartWrite = writeToUART;
}

/**
 * @brief Publish an MQTTS packet to the broker specified in 'mqclient'
 * @param topic The topic where this message should be sent to
 * @param msg Object representing the message to send
 * @return General resolve promise for running code after the transaction
 *
 * All modification to messages and topics should be made in config.js.
 */
function send(topic, msg) {
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
function sendMsgs(msg) {
  for (const topic of gateway.topics) {
    if (msg[topic] != null) {
      msg[topic].timeStamp = moment().utc().format("YYYY-MM-DDTHH:mm:ss.SSS\\Z");
      send(topic, msg[topic]);
    }
  }
}

let ttl = 0, stime = 0;

/**
 * @brief Start the MQTT
 */
function startMQTT() {
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
      showMsg("error", "Bad input JSON string received via MQTT: " + msg.toString());
      return;
    }
    if (topic == "game") {
      if ("sensortagID" in rxDict && rxDict.wall) {
        if (port.isOpen) {
          uartWrite({addr: "ffff", str: rxDict.sensortagID.replace(/^0+/, '') + ",LOST GAME"});
        }
      } else if ("sensortagID" in rxDict && rxDict.villain) {
        if (port.isOpen) {
          uartWrite({addr: "ffff", str: rxDict.sensortagID.replace(/^0+/, '') + ",WIN"});
        }
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
function end(reason) {
  mqclient.unsubscribe("commands");
  mqclient.end(true, {reasonCode: 1, options: {reasonString: reason}}, process.exit);
}
