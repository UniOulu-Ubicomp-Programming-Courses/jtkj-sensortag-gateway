# SensorTag Gateway

Johdatus tietokonejärjestelmiin 2021 / Introduction to Computer Systems 2021

This enables you to communicate with the JTKJ background system using the Texas Instruments SensorTag(s).

## Installation 

Dependencies:
```
nodejs
npm
```

Usage instructions:
* Copy this project to your computer
* Open a terminal in the project directory
* Run `npm install` once
* Run `node gateway`

The basic config uses baudrate 9600 and UART messages end in '\0'.

## Message format

| Key     | Value    | Meaning |
| ------- |:--------:| ------- |
| id      | At most 4 hexadecimal characters | SensorTag ID |
| event   | UP/DOWN/RIGHT/LEFT | Game avatar control event |
| time    | Integer | The timestamp of current sensor data row, optional |
| ping    | | Respond with 'pong' to the sending ID. |
| session | start/end | Session collects sensor data in the gateway. Once the session ends, the
data is sent to the database and can be viewed by refreshing the graph. Starting the session when a
session is already open will empty the session. |

Sensor data fields are: temp, humid, press, light, ax, ay, az, gx, gy, gz.
Sensor data is given as a floating point number.

Examples:

| Message | Meaning |
| ------- | ------- |
| event:DOWN | If the game is visible in a browser, move the avatar down by one step |
| ping,event:UP | Move avatar up. Replies with 'pong' once the command has been executed correctly |
| session:start,temp:27.82,session:end,ping | Start a sensor data session, write one temperature
value in the session and write it to database. Reply with 'pong' after execution |
| event:RIGHT,light:208 | Move avatar right. Record light level into an open sensor data session |
