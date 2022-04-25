[Русское описание](https://github.com/VladimirKalachikhin/naiveGPXlogger/blob/master/README.ru-RU.md)  
# naiveGPXlogger for SignalK [![License: CC BY-SA 4.0](https://img.shields.io/badge/License-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)

## v. 0.0
A simple plugin that just records a stream of coordinates to a [.gpx](https://www.topografix.com/gpx.asp) file in the user-defined directory.

## Features
* record points at a specified time interval or as coordinates arrive
* recording points at a specified distance
* creating a new segment when the position is lost during the specified time
* one log for the whole trip or a separate log every day
* server reboot resistance

## Usage
### By end user
Check and uncheck checkbox "Write log" on plugin configuration page in "Plugin Config" menu of SignalK web admin.  
The [GaladrielMap](https://www.npmjs.com/package/galadrielmap_sk) can show a recordable file and has a switch in the interface to control the log recording.

### By programmer
The naiveGPXlogger creates a **navigation.trip.logging** path in the SignalK data model. The value by this path is:  

```
{
  "status": boolean,   
  "logFile": "full/log/file/name"
}
```

where "status" is the state of the record: is on or off; and "logFile" - full name of log file in server file system.  
In order to enable logging, the client application must send a _delta_ message for this path with `"status": true`  
If at the same time the "logFile" will contain a directory path (with trailing slash) - the log will be recorded in this directory.  
The log recording is stopped by sending a _delta_ message with `"status": false`  
The basic example is in the sample.html

## Install&configure:
Use SignalK web admin interface to install plugin from SignalK Appstore as **naivegpxlogger**.  
Restart SignalK,  
Use Server -> Plugin Config menu to start plugin and configure parameters. 

## Support

[Discussions](https://github.com/VladimirKalachikhin/Galadriel-map/discussions)

The forum will be more lively if you make a donation [via PayPal](https://paypal.me/VladimirKalachikhin)  at [galadrielmap@gmail.com](mailto:galadrielmap@gmail.com) or at [ЮMoney](https://yasobe.ru/na/galadrielmap)

[Paid personal consulting](https://kwork.ru/it-support/20093939/galadrielmap-installation-configuration-and-usage-consulting)  
