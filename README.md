# SensorTag Gateway

Johdatus tietokonejärjestelmiin 2021-2023 / Introduction to Computer Systems 2021-2023

This is a gateway program that enables communication with the JTKJ background system using the Texas Instruments SensorTag(s).


## Installation 

Dependencies:
```
nodejs
npm
```
**Installation instructions**
1. Install Node.js, for example, from its own [homepage](https://nodejs.org/en/download/)
    * Install also *Additional tools* when required.
    * If you find problems in Windows:
      * If the installation does not succeed try to follow the steps indicated in [this blog post](https://github.com/nodejs/node/issues/26279#issuecomment-960601551)
      * If the previous does not work, try to install  [Visual Studio Build Tools](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=BuildTools) or [Visual Studio Community](https://visualstudio.microsoft.com/thank-you-downloading-visual-studio/?sku=Community)
1. Download or clone the whole repository in a folder of your file system.
1. Open the Command Prompt / Terminal. Go to the folder where you have downloaded the gateway files and type: `npm install` (only once)
   * Some students report that they have to install some of the dependencies manually. For that, in the same folder as you download the gateway:
        `npm install <missing-dependency>` where missing dependency is the library required 
1. Run `node gateway.js`   
    
**Running instructions**
* Run `node gateway.js`

The basic config uses baudrate 9600 and UART messages end in '\0'. More information on setting baudrate with `node gateway.js --help`.

For trying the program out yourself, you can set the interface to offline mode to prevent outgoing connections to backend. This can be done by using the command line flag `node gateway.js -o`.

## Messaging through the gateway

The gateway can receive and send messages either wirelessly or by using UART, depending on how the Sensortag is connected. 

The messages sent from the SensorTag should always be zero-terminated ('\0'), because the message delimiter is a zero byte. 

With UART communications, the standard `UART_write(uartHandle, str, strlen(str))` does not end the message in zero, and instead it has to be manually added. Remember, the function strlen only counts up to the first zero, not including it.

### Message format examples

The allowed key-value pairs are:

| Key     | Value    | Meaning |
| ------- |:--------:| ------- |
| id      | Four hexadecimal characters | SensorTag ID. Not needed with wireless communications, but must be given when directly using UART! |
| EAT     | Integer from 0 to 10 | Feed tamagotchi |
| EXERCISE| Integer from 0 to 10 | Exercise tamagotchi |
| PET     | Integer from 0 to 10 | Pet tamagotchi |
| ACTIVATE| Three integers from 0 to 10 | Feed, Exercise and Pet tamagotchi in a single message. Integers are separated by ';': An example would be "2;0;7" |
| MSG1    | String | Any text the user wants to show next to the tamagotchi. One of two |
| MSG2    | String | Any text the user wants to show next to the tamagotchi. One of two |
| time    | Integer | The timestamp of current sensor data row, optional |
| ping    | | Respond with 'pong' to the sending ID, if the message was interpreted without error. Extra 'session:end's are not errors, so ping can be used to reliably end sensor data sessions in weak signal situations |
| session | start/end | Session collects sensor data in the interface. Once the session ends, the data is sent to the database and can be viewed by refreshing the graph. Starting the session when a session is already open will empty the session |

Commas (',') are not supported within values, like MSG1 and MSG2!

Examples: 

| Message | Meaning |
| ------- | ------- |
| id:23,EAT:8 | Your SensorTag ID is 0023. If the tamagotchi is visible in a browser, feed it 8 times |
| id:23,PET:2,EXERCISE:1 | If the tamagotchi is visible in a browser, pet it 2 times and exercise once |
| id:123,EXERCISE:2,ping | Exercise tamagotchi by 2. Replies with 'pong' once the command has been executed correctly |
| id:42,MSG1:Health: ##--- 40%,MSG2:State 2 / Value 2.21 | Set msg1 to "Health: ##--- 40%", and msg2 to "State 2 / Value 2.21". Remember, there can be no commas in the msg values |
| id:15,session:start,temp:27.82,session:end,ping | Start a sensor data session, write one temperature value in the session and write it to database. Reply with 'pong' after execution |
| id:1234,ACTIVATE:1;2;3,light:208 | Feed tamagotchi 1, exercise tamagotchi 2, pet tamagotchi 3. Record light level into an open sensor data session, if one exists |

### Sending raw sensor data  

To send sensor data as messages, the session has to first be started, sensor data is sent to the session, and the session is ended. Here is an example of a typical session with a single message per line:

```
session:start
time:2,ax:0.21,ay:0.01,az:-0.02
time:52,ax:0.41,ay:0.03,az:-0.05
time:103,ax:0.35,ay:-0.01,az:0.02
time:153,ax:-0.38,ay:0.21,az:0.06
time:204,ax:-0.12,ay:0.15,az:-0.08
session:end
```

Accepted sensor data fields are: temp, humid, press, light, ax, ay, az, gx, gy, gz. Any of them can be given in each message within a session. Sensor data is given as a floating point number.

The 'time' field can be used to indicate the current time according to the SensorTag, and otherwise it is the milliseconds since session:start according to the gateway. Session can be cleared mid-session by sending session:start again.

| Key     | Value    | Meaning |
| ------- |:--------:| ------- |
| temp    | float/double    | Temperature sensor data|
| humid   | float/double | Humidity sensor data|
| press   | float/double | Barometer sensor data|
| light   | float/double | Ambient light sensor data|
| ax, ay, az | float/double | Accelerometer data|
| gx, gy, gz | float/double | Gyroscope data|

### Sending messages from the gateway

All typed text not beginning with a '.' character is sent to the connected SensorTag via UART. This always sends a 80 bytes long zero terminated string, meaning, you can use a fixed size reception buffer, or the delimiter '\0', to receive the UART message. 

The Tamagotchi sends a message 'id,BEEP' from the backend for each value when it is low. For example, if the client's SensorTag ID is 0432, this message will be '432,BEEP'. Note the missing leading zeros.


## Usage of the Terminal User Interface

When the program starts, it attempts to find a serial port for the connected SensorTag. In this phase, if the port is not automatically found, the user can input a port number to connect to. Automatic port selection can be disabled by using the `-m` flag.

After connecting to a port, the TUI can be used to manually send messages to the connected SensorTag, and to control the gateway by commands displayed in '.help'. 

The most notable command is '.reconnect', which can be used to try to re-establish connection to the SensorTag, if you should need to do so.
