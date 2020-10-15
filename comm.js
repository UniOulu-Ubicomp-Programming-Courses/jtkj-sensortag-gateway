mqtt = require("mqtt");
const mqclient = mqtt.connect(gateway.mqtt.host, gateway.mqtt.options);

module.exports = {
  startMQTT: startMQTT,
  send: send,
  sendMsgs: sendMsgs,
  end: end
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

function sendMsgs(msg) {
  for (const topic of gateway.topics) {
    if (msg[topic] != null) {
      msg[topic].timeStamp = moment().utc().format("YYYY-MM-DDTHH:mm:ss.SSS\\Z");
      send(topic, msg[topic]);
    }
  }
}

let ttl = 0, stime = 0;

function startMQTT() {
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
    try { // TODO move to main
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
      if (false && process.argv.indexOf("-s") != -1) // TODO treating the symptom instead of the problem
        console.log("Broker unreachable:", err.message);
      ttl = stime = (stime < 50 ? stime+2 : 50);
    }
    else console.log(err);
  });
}

function end(reason) {
  mqclient.unsubscribe("commands");
  mqclient.end(true, {reasonCode: 1, options: {reasonString: reason}}, process.exit);
}
