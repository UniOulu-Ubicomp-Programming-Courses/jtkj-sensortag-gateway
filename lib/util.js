/**
 * @file util.js
 * @brief Various utility functions for the gateway program
 * @author Vili Pelttari
 */

const readline = require("readline");

// readline gateway for reading console input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\033[31m$\033[0m ',
  terminal: true
});
rl.on('close', () => process.exit(0));

module.exports = {
  rl: rl,
  showMsg: showMsg,
  closestMatch: closestMatch,
  levenshtein: levenshtein,
  parseArgv: parseArgv,
  decodeEscapedBuffer: decodeEscapedBuffer
}


/**
 * @brief Send a message on all gateways (the console and the backend connection)
 * @param topic The topic of this message (info, error, debug, recv)
 * @param str The message
 * @return A resolve promise to guarantee completition
 */
function showMsg(topic, str) {
  return new Promise(resolve => {
    process.stdout.write("\033[1G\033[2K"); // move cursor to beginning of line
    console.log(str);
    rl.prompt(true); // write prompt
    //comm.send(topic, str).then(resolve); // can forward error to backend
    resolve();
  });
}


/**
 * @brief Find the closest match to str from suggestions, using Levenshtein
 * @param str String approximating a match in suggestions
 * @param suggestions Suggestions where a closest pair for str should be searched from
 * @return The suggestion matching str the best
 */
function closestMatch(str, suggestions) {
  let bestMatch, bestNum = 100, dist;
  for (const sugg of suggestions) {
    dist = levenshtein(str, sugg);
    if (dist < bestNum) {
      bestNum = dist;
      bestMatch = sugg;
    }
  }
  return bestMatch;
}

/**
 * @brief Calculate the Levenshtein distance between two strings
 * @param str1
 * @param str2
 * @return Levenshtein distance between str1 and str2
 */
function levenshtein(str1, str2) {
  let m = str1.length, n = str2.length;
  let d = new Array(m+1);
  if (n == 0) return m;
  if (m == 0) return n;
  for (let i = 0; i <= m; i++) {
    d[i] = new Array(n+1);
    d[i][0] = i;
  }
  for (let i = 0; i <= n; i++) {
    d[0][i] = i;
  }

  for (let j = 1; j <= n; j++) {
    for (let i = 1; i <= m; i++) {
      cost = (str1[i - 1] == str2[j - 1]) ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

/**
 * @brief Parse vector of command line arguments.
 * @param dict The dictionary 'gateway' defined in config.js. CLI options change the config defined
 * there.
 */
function parseArgv(dict) {
  let k = 2, t = 0;
  while (k < process.argv.length) {
    switch (process.argv[k]) {
      case "-b": // baud rate selection
        k++;
        dict.uart.baudRate = parseInt(process.argv[k]);
        break;
      case "-d": // debug mode
        dict.debugMode = true;
        break;
      case "-m": // manual port selection
        dict.ports.autofind = false;
        break;
      case "-o": // offline mode
        dict.offline = true;
        break;
      case "-s": // server usage
        dict.isServer = true;
        dict.uart.baudRate = dict.server.baudRate;
        dict.uart.pipe = dict.server.pipe;
        dict.uart.delim = dict.server.delim;
        break;
      default:
        console.error("Usage:\n" +
          "  node gateway [-b baudRate] [-d] [-m] [-o] [-s]\n" +
          "Options:\n" +
          "      -b baudRate\n" +
          "           Set UART \033[1mbaudrate\033[0m. Should be one of following:\n" +
          "             4800, 9600, 19200, 38400, 57600, 76800, 115200.\n" + 
          "      -d   Use \033[1mdebug\033[0m mode. Shows extra data, and can be used to test messages.\n" +
          "      -m   Set \033[1mport\033[0m selection to manual. Disables automatic selection.\n" +
          "      -o   Set gateway to \033[1moffline mode\033[0m, and the connection to backend is not established.\n" +
          "      -s   Use automatic config for \033[1mserver\033[0m usage."
          );
        process.exit(1);
    }
    k++;
  }
}

/**
 * @brief Parse an integer from a string
 * @param str String that supposedly represents a number
 * @return Number from str if it contained a number. Else print error and exit process.
 */
function parseInt(str) {
  let t = Number.parseInt(str);
  if (isNaN(t)) {
    console.error("Invalid integer: " + str);
    process.exit(1);
  }
  return t;
}

/**
 * @brief Decode a buffer from replaced characters using escape characters
 * @param b Buffer object encoded in the ServerTag
 * @return Buffer object of the decoded bytes, with clipped length
 *
 * Let the following characters have the corresponding significances.
 *    '0': escape character
 *    '1': stand-in character for '2' in the encoded string
 *    '2': end of message character used to signify UART message end.
 * Then the string 'ex0am1p02l01e2' will be encoded into 'ex0am1p0001l001e01' not containing the
 * EOM character '2', and this will be then decoded using this function back into 'ex0am1p02l01e2'.
 */
function decodeEscapedBuffer(b) {
  let escLen = 0, len = 0, windex = 0;
  // Characters:
  let ESCAPECHAR = 0xf0;
  let STANDINCHAR = 0xf1;
  let EOMCHAR = 0xf2;

  let resultBuffer = Buffer.from(b); // Buffers cannot be allocated dynamically
  resultBuffer.fill(0);

  for (c of b) {
    if (c == ESCAPECHAR) escLen++;
    else {
      if (c == STANDINCHAR) {
        len = escLen >> 1;
        while (len-- > 0) resultBuffer[windex++] = ESCAPECHAR;
        if (escLen % 2) resultBuffer[windex++] = EOMCHAR;
        else resultBuffer[windex++] = STANDINCHAR;
      } else {
        if (escLen > 0)
          while (escLen-- > 0) resultBuffer[windex++] = ESCAPECHAR;
        resultBuffer[windex++] = c;
      }
      escLen = 0;
    }
  }
  while (escLen-- > 0) resultBuffer[windex++] = ESCAPECHAR;
  return resultBuffer.slice(0, windex); // windex gives the resulting buffer length
}
