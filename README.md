# SensorTag Interface

Johdatus tietokonejärjestelmiin 2021 / Introduction to Computer Systems 2021

This is an interface that enables communication with the JTKJ background system using the Texas Instruments SensorTag(s).

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
* Run `node interface`

The basic config uses baudrate 9600 and UART messages end in '\0'. More information on setting
baudrate with `node interface --help`.

## Message format

| Key     | Value    | Meaning |
| ------- |:--------:| ------- |
| id      | At most 4 hexadecimal characters | SensorTag ID. Must be given when using UART! |
| EAT     | Integer from 0 to 10 | Feed tamagotchi |
| PET     | Integer from 0 to 10 | Pet tamagotchi |
| EXERCISE| Integer from 0 to 10 | Exercise tamagotchi |
| ACTIVATE| Three integers from 0 to 10 | Feed, Pet and Exercise tamagotchi in a single message. Integers are separated by ';': An example would be "2;0;7". |
| MSG1    | String | Any text the user wants to show next to the tamagotchi. One of two. |
| MSG2    | String | Any text the user wants to show next to the tamagotchi. One of two. |
| time    | Integer | The timestamp of current sensor data row, optional |
| ping    | | Respond with 'pong' to the sending ID. |
| session | start/end | Session collects sensor data in the interface. Once the session ends, the data is sent to the database and can be viewed by refreshing the graph. Starting the session when a session is already open will empty the session. |

Sensor data fields are: temp, humid, press, light, ax, ay, az, gx, gy, gz.
Sensor data is given as a floating point number.

Commas (',') are not supported within values, like MSG1 and MSG2!

Examples:

| Message | Meaning |
| ------- | ------- |
| id:0023,EAT:8 | If the tamagotchi is visible in a browser, feed it 8 times |
| id:0023,PET:2,EXERCISE:1 | If the tamagotchi is visible in a browser, pet it 2 times and exercise once |
| id:0123,EXERCISE:2,ping | Exercise tamagotchi by 2. Replies with 'pong' once the command has been executed correctly |
| id:0042,MSG1:Health: ##--- 40%,MSG2:State 2 / Value 2.21 | Set msg1 to "Health: ##--- 40%", and msg2 to "State 2 / Value 2.21". Remember, there can be no commas in the msg values |
| id:0015,session:start,temp:27.82,session:end,ping | Start a sensor data session, write one temperature value in the session and write it to database. Reply with 'pong' after execution |
| id:1234,EAT:10,light:208 | Feed tamagotchi 10. Record light level into an open sensor data session, if one exists |
