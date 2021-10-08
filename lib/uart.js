const gateway = require("../config");
const Fifo = require("queue-fifo");
const portFinder = require("./portFinder");
let uart = {};
uart.responded = false; // communicate if the challenge-response has been cleared
let uartSenderService;
let uartSendBuffer = new Fifo(); // space out outgoing UART messages in time

/**
 * @brief Send messages TXLENGTH bytes long from the UART send queue with time in between
 *
 * Monitors the UART send message queue and send messages from it with enough time in between
 * for the ServerTag to execute them properly.
 */
uartSender = uart.uartSender = () => {
  if (uartSendBuffer.isEmpty() || !gateway.port) {
    return;
  }
  var [txBuf, publish] = uartSendBuffer.dequeue();
  var msg = txBuf.subarray(2).toString().replace(/\0/g, '');
  var addr = ("0000" + txBuf.readUInt16LE().toString(16)).slice(-4);
  gateway.port.write(txBuf, function(err) {
    if (err) {
      showMsg("error", "UART write error: " + err.message);
      // prevent spam by discarding the message
    } else if (publish && gateway.port.isOpen) {
      showMsg("info", "Sent '" + msg + "' to 0x" + addr);
    } else if (publish) {
      showMsg("error", "Sending aborted. SensorTag isn't connected.");
    }
  });
}
uartSenderService = setInterval(uartSender, 50);

/**
 * @brief Send an UART message. The message will be formed with the address, and added to a message
 * queue from which it will be sent by the uartSenderService
 * @param msg Dictionary describing what to send. 'str' is a necessary field. If 'addr' is
 *        specified, ServerTag will send an 6LoWPAN message to the provided address. If 'internal'
 *        is given, raw text will be sent.
 *          -str:      Message text (converted to ascii in this function, to prevent buffer problems)
 *          -addr:     Receiver address as a string of four hex characters ('ffff' is broadcast)
 *          -internal: Set if raw text has to be sent over UART
 */
uartWrite = uart.uartWrite = (msg, publish=true) => {
  let txBuf = Buffer.alloc(gateway.uart.txlength), addr = "ffff";
  if (gateway.isServer && !("internal" in msg)) {
    if ("addr" in msg && msg.addr != null)
      addr = msg.addr;
    txBuf.writeUInt16LE(Number.parseInt(addr, 16));
    txBuf.asciiWrite(msg.str, 2);
  } else {
    txBuf.asciiWrite(msg.str);
  }
  // Add to FIFO send queue
  uartSendBuffer.enqueue([txBuf, publish])
}

/**
 * @brief Check and send the heartbeat query. Used to check if the ServerTag has crashed
 */
heartbeat = uart.heartbeat = () => {
  let now = Date.now();
  if (gateway.heartbeatInterval*1.5 < now - uart.hbTime && now - uart.hbTime < gateway.heartbeatInterval*2.5) {
    showMsg("error", "Error: Heartbeat: The ServerTag has possibly crashed!");
  }
  uartWrite({str: "\x00\x00\x01HB", internal: true}, false);
}

/**
 * @brief Check the response to the challenge and set the current state as necessary
 * @param data The UART data buffer
 * @return Whether or not the response was satisfactory
 */
parseChallenge = uart.parseChallenge = (data) => {
  let str;
  if (gateway.debugMode) {
    console.log("UART:", JSON.stringify(data.toString().replace(/\x00*$/, '')));
  }
  if (data[0] == data[1] && data[1] == 0xfe && data[2] == 1) {
    str = data.slice(3).toString().replace(/\0*$/g, '');
    showMsg("info", "Challenge response: " + str);
    portFinder.clearBlacklist();
    uart.responded = true;
  }
  return false;
}

/**
 * @brief Send a challenge to the newly connected ServerTag and start a timeout for the function
 *        that will disconnect it if it didn't respond correctly
 */
sendChallenge = uart.sendChallenge = () => {
  uartWrite({str: "\x00\x00\x01Identify", internal: true}, false);
  uart.responded = false;
  setTimeout(function() { // wait the grace period and check 'responded' after that
    if (!uart.responded) {
      showMsg("info", "No response to challenge. Disconnecting.");
      portFinder.nextPort();
      gateway.port.close(err => {if (err) {showMsg("error", "Port close error: "+err);}}); // activates port.on('close')
      console.log("\n");
      return;
    }
  }, 3000);
}

module.exports = uart;
