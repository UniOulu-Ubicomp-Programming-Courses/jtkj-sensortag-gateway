/**
 * @file util.js
 * @brief Various utility functions for gateway.js
 * @author Vili Pelttari
 * @date 27.10.2020
 */

module.exports = {
  closestMatch: closestMatch,
  levenshtein: levenshtein,
  parseArgv: parseArgv
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
  let n = str1.length, m = str2.length;
  let d = new Array(n+1);
  if (n == 0) return m;
  if (m == 0) return n;
  for (let i = 0; i <= n; i++) {
    d[i] = new Array(m+1);
    d[i][0] = i;
  }
  for (let i = 0; i <= m; i++) {
    d[0][i] = i;
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cost = (str1[j - 1] == str2[i - 1]) ? 0 : 1;
      d[i][j] = Math.min(Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1), d[i - 1][j - 1] + cost);
    }
  }
  return d[n][m];
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
      case "-m": // manual port selection
        dict.ports.autofind = false;
        break;
      case "-s": // server usage
        dict.isServer = true;
        dict.uart.baudRate = dict.server.baudRate;
        dict.uart.pipe = dict.server.pipe;
        break;
      default:
        console.error("Usage:\n" +
          "  node gateway [-s]\n" +
          "Options:\n" +
          "      -b   Set UART \033[1mbaudrate\033[0m. Should be one of following:\n" +
          "             4800, 9600, 19200, 38400, 57600, 76800, 115200\n" + 
          "      -m   Set \033[1mport\033[0m selection to manual. Disables automatic selection.\n" +
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
