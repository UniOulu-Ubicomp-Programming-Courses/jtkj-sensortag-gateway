/**
  * @file portFinder.js
  * @brief Module for finding serial ports in gateway.js
  * @author Vili Pelttari
  * @version 1.0.2
  * @date 07.07.2020
  */

const gateway = require("./config");

module.exports = {
  /**
  * @brief Initiate the module with external function handles
  * @param erl Readline handle
  * @param eshowMsg Function handle for displaying messages on all interfaces
  * @param esend Function handle for sending a packet to the server
  * @param econsoleHandler Function that handles console input after this module returns
  */
  init: function(erl, eshowMsg, esend, econsoleHandler) {
    rl = erl;
    showMsg = eshowMsg;
    send = esend;
    consoleHandler = econsoleHandler;
  },

  /**
  * @brief Start finding new ports
  * @param cb Callback function that will be called with an open serial port
  */
  findPorts: function(cb) {
    portUI(cb);
  },

  /**
  * @brief Clear the device blacklist to allow blacklisted devices to be discovered
  */
  clearBlacklist: function() {
    blacklist = {};
  },

  /**
  * @brief Increment the port when there are multiple automatically accepted devices
  */
  nextPort: function() {
    let m = n - 1;
    if (m < 0)
      m += ok.length;
    if (ok.length)
      blacklist[ok[m][1]] += 1;
  },
};

let
  rl = null;
  showMsg = null;
  send = null;
  consoleHandler = null;
  count = 0;
  n = 0;
  ok = [];
  all = {};
  blacklist = {};

/**
 * @brief Find new serial devices and connect to them automatically if they are SensorTags
 * @return Promise resolve when a suitable SensorTag has been found, with the port path
 */
function listPorts() {
  process.stdout.write("\033[u\033[0J");
  let update = false;
  let finds = 0, oldfinds = 0;
  return new Promise(resolve =>{
    let portlister = setInterval(async () => {
      if (count == -1) { clearInterval(portlister); return; }
      // list ports
      await SerialPort.list().then(ports => {
        ports.forEach(port => {
          if (!(port.path in all)) {
            update = true;
            all[port.path] = port.pnpId;
            count++;
          }
          finds |= 1<<(Object.keys(all).indexOf(port.path));
        });
      });
      // remove disconnected ports
      update |= removeOld((finds^oldfinds)&oldfinds); // bit operation for finding bits that are only 'on' in oldfinds
      if (update) dispPorts();
      update = false;
      oldfinds = finds;
      finds = 0;
      // automatically find ok ports
      for (const port of Object.entries(all)) {
        if (/Texas.*if00$|USB\\VID_0451.*0000$/i.test(port[1]) && ok.findIndex(p => p[1]==port[1]) == -1) {
          ok.push([port[0], port[1]]);
          if (!(port[1] in blacklist)) blacklist[port[1]] = 0; // add to blacklist with 0
        }
      }
      // try a different port if the other one didn't respond correctly before
      if (ok.length) {
        ok.sort();
        n %= ok.length;
        if (blacklist[ok[n][1]] > 3) { // stop spamming a port after 4 tries
          n++;
          return;
        }
        clearInterval(portlister); // count = -1; works too
        resolve(ok[n++][0]);
      }
    }, 1000); // look for new ports every second
  });
}

/**
 * @brief Remove disconnected ports
 * @param n Number with 'on' bits in positions corresponding to removed devices
 * @return True if some port was removed. Else false
 */
function removeOld(n) {
  let p = 1, changes = false;
  let keys = Object.keys(all);
  for (let i = 0; i < 30; i++) {
    if (n&p && keys[i] != undefined) {
      changes = true;
      //send(["event", {num: i+1, path: keys[i], id: all[keys[i]]}]);
      count--;
      delete(all[keys[i]]);
    }
    p <<= 1;
  }
  return changes;
}

/**
 * @brief Print the port menu to console
 */
function dispPorts() {
  process.stdout.write("\033[u\033[0J"); // see console_codes(4)
  let i = 0, color;
  for (const port of Object.entries(all)) {
    color = (port[1] in blacklist && blacklist[port[1]] > 3 ? "\033[31m" : "\033[32m");
    process.stdout.write(color + String(i+1) + "\033[0m:\033[33m " + port[0] + "\033[0m " + port[1] + "\n");
    i++;
  }
  process.stdout.write("Choose port number: ");
}

/**
 * @brief Checks the user input from stdin
 * @param line The input line from the portUIInput function
 * @return Promise resolve when the input is ok, reject otherwise
 */
function checkInput(line) {
  return new Promise((resolve, reject) => {
    if (isNaN(line=Number(line).toFixed(0))) {
      process.stdout.write("\033[KThe input should be a number.\033[1A\033[21G\033[K");
    } else if (line < 1 || line > Object.keys(all).length) {
      process.stdout.write("\033[KPlease choose one of the numbers above.\033[1A\033[21G\033[K");
    } else {
      count = -1;
      let key = Object.keys(all)[line-1];
      if (!(all.key in blacklist)) blacklist[all.key] = 0; // add to blacklist with 0
      resolve(key);
    }
    reject();
  });
}

/**
 * @brief Reads stdin until a correct option is selected
 * @return Promise resolve when a correct port option has been selected
 */
function portUIInput() {
  rl.removeAllListeners(["line"]);
  return new Promise(resolve => {
    rl.on("line", line => checkInput(line).then(resolve, ()=>{}));
  });
}

/**
 * @brief The main function for selecting a serial device. Has has its own rl.on('line') handlers.
 * @param cb Callback function (main)
 * @return Calls cb with the opened port
 */
async function portUI(cb) {
  let path = "", start = true;
  count = 0;
  ok = [];
  all = {};
  let input = portUIInput();
  let list = listPorts();
  showMsg("info", "Discovering serial devices...");
  path = await Promise.race([input, list]); // wait for a Promise to resolve
  if (count != -1) {
    console.log(""); // new line
    showMsg("info", "SensorTag automatically found.");
  }
  showMsg("info", `Connecting to ${path}.`);
  port = new SerialPort(path, {baudRate: gateway.uart.baudRate}, function(err) {
    if (err === null) return;
    showMsg("error", "Bad port: " + err.message);
    portUI(cb);
    return;
  }); // TODO move to gateway.main and form this into resolve
  rl.removeAllListeners(["line"]);
  rl.on("line", consoleHandler);
  cb(port);
}