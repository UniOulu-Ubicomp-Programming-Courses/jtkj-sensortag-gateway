/**
 * @file portFinder.js
 * @brief Module for finding serial ports in the gateway program
 * @author Vili Pelttari
 */

const gateway = require("../config");
const util = require("./util");

module.exports = {
  /**
   * @brief Initiate the module with external function handles
   * @param erl Readline handle
   * @param econsoleHandler Function that handles console input after this module returns
   */
  init: function(econsoleHandler) {
    consoleHandler = econsoleHandler;
  },

  /**
  * @brief Start finding new ports
  * @param cb Callback function that will be called with an open serial port
  */
  findPorts: findPorts,

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
  let finds = 0, oldfinds = 0; // XXX good up to 53 devices
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
        // XXX modify this regex if autodetect doesn't work (should work on Windows and Linux)
        if (/Texas.*if00$|USB\\VID_0451.*0000$/i.test(port[1]) && ok.findIndex(p => p[1]==port[1]) == -1) {
          ok.push([port[0], port[1]]);
          if (!(port[1] in blacklist)) blacklist[port[1]] = 0; // add to blacklist with 0
        }
      }
      // try a different port if the other one didn't respond correctly before
      if (gateway.ports.autofind && ok.length) {
        ok.sort();
        n %= ok.length;
        if (blacklist[ok[n][1]] > gateway.ports.maxTries) { // stop spamming a port after maxTries tries
          n++;
          return;
        }
        clearInterval(portlister);
        resolve(ok[n++][0]);
      } else if (!gateway.ports.autofind && count > 0) clearInterval(portlister); // stop port finding if port was selected
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
  process.stdout.write("\033[u\033[J"); // see console_codes(4). Restore cursor location and erase display down
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
  util.rl.removeAllListeners(["line"]);
  return new Promise(resolve => {
    util.rl.on("line", line => checkInput(line).then(resolve, ()=>{}));
  });
}

/**
 * @brief The main function for selecting a serial device. Has has its own rl.on('line') handlers.
 * @return Promise resolve with path of port to connect to
 */
async function findPorts() {
  let path = "", start = true;
  count = 0;
  ok = [];
  all = {};
  return new Promise(async (resolve, reject) => {
    // Wait for one port selection method to complete
    let input = portUIInput();
    let list = listPorts();
    util.showMsg("info", "Discovering serial devices...");
    path = await Promise.race([input, list]); // wait for a Promise to resolve
    if (count != -1) {
      util.showMsg("info", ""); // new line
      util.showMsg("info", "SensorTag automatically found.");
    }
    util.showMsg("info", `Connecting to ${path}.`);
    util.rl.removeAllListeners(["line"]);
    util.rl.on("line", consoleHandler);
    resolve(path);
  });
}
