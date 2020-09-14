var gateway = {};

gateway.mqtt = {};
// real port is 1883, test server on 3003
gateway.mqtt.host = 'mqtt://localhost:1883';
gateway.mqtt.options = {
    //ca: fs.readFileSync('certs/root/root.crt'), // XXX a custom certificate file
  // XXX client certificates for MQTTS (TLS version of MQTT):
    //key: fs.readFileSync('certs/client/client.key'),
    //cert: fs.readFileSync('certs/client/client.crt'),
};
gateway.uart = {};
gateway.uart.rxlength = 32;
gateway.uart.txlength = 17;
gateway.uart.baudRate = 57600;

// XXX Edit this for configuring new demos XXX

/* Description of the data format: Add entries to include more possible data properties.
 *
 * name: Name this property will have in sent MQTT messages
 * uses: Function for the number of bytes this property will consume from buffer, argument is the data buffer (see fun)
 *  cmp: Test for if this property is given in the data buffer, according to the given data type
 *       identifier argument (a Buffer array!)
 *  fun: Function that extracts the data from the buffer's beginning. Buffer is always scrolled so
 *       the data specific to this property is given in the beginning
 *
 * Note: This list will be looped through, so this list's order determines the order in which the
 *       data will be in the messages from SensorTags.
 */
gateway.dataDescr = [
  {
    name: "draw",
    uses: d => 0,
    cmp:  i => (i[0]&0b1001) == 0b1,
    fun:  d => 0
  }, {
    name: "draw",
    uses: d => 0,
    cmp:  i => (i[0]&0b1001) == 0b1001,
    fun:  d => 1
  }, {
    name: "dir",
    uses: d => 12, // consumes 4 floats = 12 bytes
    cmp:  i => i[0]&0b100,
    fun:  d => [0, 4, 8].map(i => Math.round(10 * d.readFloatLE(i))/10)
  }, {
    name: "press",
    uses: d => 4,
    cmp:  i => i[0]&0b10, // bit 2 from right
    fun:  d => Math.round(10 * d.readFloatLE())/10
  }, { // msg should be last (if it can consume all bytes)
    name: "text",
    uses: d => -1, // consume all remaining bytes
    cmp:  i => i[0]&1, // bit 1 from right
    fun:  d => d.toString().replace(/\0*$/, '') // extract data from buffer
  }
];

module.exports = gateway;
