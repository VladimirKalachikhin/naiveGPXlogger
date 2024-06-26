[Русское описание](https://github.com/VladimirKalachikhin/naiveGPXlogger/blob/master/README.ru-RU.md)  
# naiveGPXlogger for SignalK [![License: CC BY-NC-SA 4.0](Cc-by-nc-sa_icon.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.en)

## v. 0.2
A simple plugin that just records a stream of coordinates to a [.gpx](https://www.topografix.com/gpx.asp) file in the user-defined directory.

## Features
* record points at a specified time interval or as coordinates arrive
* recording points at a specified distance
* creating a new segment when the position is lost during the specified time
* one log for the whole trip or a separate log every day
* store depth as [Garmin extension](https://www8.garmin.com/xmlschemas/GpxExtensions/v3/GpxExtensionsv3.xsd)
* server reboot resistance
* recording can be initiated by a Man Overboard (MOB) event on the SignalK server

## Usage
### By end user
Check and uncheck checkbox "Write log" on plugin configuration page in "Plugin Config" menu of SignalK web admin. Press Submit.  
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

The forum will be more lively if you make a donation at [ЮMoney](https://sobe.ru/na/galadrielmap)

[Paid personal consulting](https://kwork.ru/it-support/20093939/galadrielmap-installation-configuration-and-usage-consulting)  
