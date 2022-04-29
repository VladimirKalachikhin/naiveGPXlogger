module.exports = function (app) {
const fs = require('fs');
const events = require('events');

var plugin = {};
plugin.id = 'naivegpxlogger';
plugin.name = 'naiveGPXlogger';
plugin.description = 'Simple SignalK gpx logger';

plugin.schema = {
"title": plugin.name,
"description": "Some parameters need for use",
"type": "object",
"required": ["trackDir"],
"properties": {
	"logging": {
		"type": "boolean",
		"title": "Write log",
		"description": "If there is no other way to control log recording, enable recording here",
		"default": false
	},
	"trackFrequency": {
		"type": "integer",
		"title": "Position registration frequency, sec.",
		"description": "The points will be placed after so seconds, but not more often than through the minimum distance. If 0 - every fix.",
		"default": 0
	},
	"minmove": {
		"type": "number",
		"title": "A minimum move distance in meters",
		"description": "It may include a fractional decimal part. Motions shorter than this will not be logged.",
		"default": 5
	},
	"trackTimeout": {
		"type": "integer",
		"title": "A minimum no fix timeout",
		"description": "A new segment is created if there's no fix written for this interval.",
		"default": 15
	},
	"trackDir": {
		"type": "string",
		"title": "Directory with tracks",
		"description": "Path in server filesystem, absolute or from plugin directory",
	},
	"everyDay": {
		"type": "boolean",
		"title": "Start new track every new day",
		"description": "",
		"default": true
	}
}
};

var unsubscribes = []; 	// массив функций, которые отписываются от подписки на координаты
var unsubscribesControl = [];	// от подписки на управление
var	routeSaveName=''; 	// 
var logging;	// текущее состояние записи трека
var beginGPX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx xmlns="http://www.topografix.com/GPX/1/1"  creator="${plugin.name}" version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
	<metadata>
	</metadata>
	<trk>
		<trkseg>
`;

plugin.start = function (options, restartPlugin) {
//
	const path = require('path');
	const cp = require('child_process');
	
	if(!options.trackDir) options.trackDir = 'track';
	if(options.trackDir[0]!='/') options.trackDir = path.resolve(__dirname,options.trackDir);	// если путь не абсолютный -- сделаем абсолютным
	if(!fs.existsSync(options.trackDir)){
		options.trackDir = path.resolve(__dirname,'track');
		if(!fs.existsSync(options.trackDir)) fs.mkdirSync(options.trackDir);
	}

	logging = options.logging;
	app.debug('plugin started, now logging is',logging,'log dir is',options.trackDir);
	app.setPluginStatus(`Started, now logging is ${logging}, log dir is ${options.trackDir}`);
	updSKpath(logging,routeSaveName); 	// установим пути в SignalK согласно options.logging
	logging = false;	// укажем, что на самом деле запись трека не происходит
	//app.debug('Start, logging=',logging,'navigation.trip.logging.value',app.getSelfPath('navigation.trip.logging.value'));
	
	doLogging();	// запустим отслеживание включения и выключения записи трека, и будем это включать/выключать	

	return;		// конец содержательной части plugin.start
	
	
	
	// Объявления функций

	function openTrack(){
	//
	routeSaveName = new Date().toJSON()+'.gpx'; 	// 
	let lastTag;
	for(let item of fs.readdirSync(options.trackDir)) {	
		if(path.extname(item).toLowerCase() != '.gpx') continue;
		let buf = tailCustom(options.trackDir+'/'+item,5);	// сколько-то последних строк файла. Лучше много, ибо в конце могут быть пустые строки
		if(buf != false) {
			buf = buf.trim();
			if(!buf.endsWith('</gpx>')){	// незавершённый файл gpx
				routeSaveName = item;
				lastTag = buf.substring(buf.lastIndexOf('<')).trim();	// попытка найти \n привела к странному. Оно не умеет?
				if(options.currTrackFirst) break;	// текущий трек -- первый из незавершённых, иначе -- последний.
			}
		}
	}
	//app.debug('lastTag=',lastTag);
	let gpxtrack='';
	if(lastTag){
		switch(lastTag){
		case '</trkpt>':
			gpxtrack = '		</trkseg>\n		<trkseg>\n'
			break;
		case '</trkseg>':
			gpxtrack = '\n		<trkseg>\n'
			break;
		}
	}
	else {
		gpxtrack = beginGPX;
	}
	//app.debug(routeSaveName,'gpxtrack:',gpxtrack);

	routeSaveName = path.resolve(options.trackDir,routeSaveName);
	try {
		fs.appendFileSync(routeSaveName, gpxtrack);
	} 
	catch (err) {
		console.error(err.message);
		app.setPluginError('Unable logging:',err.message);
		return false;
	}
	
	return true;
	} // end function openTrack

	function realDoLogging(){
		let lastPosition;	// последнее положение
		let lastFix = Date.now();	// время последнего получения координат
		const TPVsubscribe = {
			"context": "vessels.self",
			"subscribe": [
				{
					"path": "navigation.position",
					"format": "delta",
					"policy": "instant",
					"minPeriod": options.trackFrequency
				}
			]
		}
		// документации на эту штуку так и нет, но удалось узнать, что вызывать это можно много раз с разными подписками
		app.subscriptionmanager.subscribe(	
			TPVsubscribe,	// подписка
			unsubscribes,	// массив функций отписки
			subscriptionError => {	// обработчик ошибки
				app.error('Error subscription to data:' + subscriptionError);
				app.setPluginError('Error subscription to data:'+subscriptionError.message);
			},
			doOnValue	// функция обработки каждой delta
		); // end subscriptionmanager

		function doOnValue(delta){	
			//
			// Новый трек каждый день
			if(options.everyDay){
				//if((new Date(lastFix).getMinutes()-new Date().getMinutes()) != 0){	// каждую минуту
				if((new Date(lastFix).getDate()-new Date().getDate()) != 0){	//
					switchOff();
					switchOn();
					app.debug('Opened new track by new day');
				}
			}

			delta.updates.forEach(update => {
				//app.debug(update);
				let timestamp = update.timestamp;	
				update.values.forEach(value => {	// если подписка только на координаты -- здесь будут только координаты
					//app.debug(value);
					switch(value.path){
					case "navigation.position":
						if(!lastPosition) {
							lastPosition = value.value;
							return;
						}
						//app.debug(equirectangularDistance(lastPosition,value.value));
						if(equirectangularDistance(lastPosition,value.value)<options.minmove) return;
						let trkpt = '			<trkpt ';
						trkpt += `lat="${value.value.latitude}" lon="${value.value.longitude}">\n`;
						trkpt += `				<time> ${timestamp} </time>\n`;
						trkpt += '			</trkpt>\n';
						//app.debug(trkpt);
						if((Date.parse(timestamp)-lastFix)>(options.trackTimeout*1000)) trkpt = '		</trkseg>\n		<trkseg>\n' + trkpt;	// если долго не было координат -- завершим сегмент
						try {
							fs.appendFileSync(routeSaveName, trkpt);
						} 
						catch (err) {
							console.error(err.message);
							app.setPluginError('Unable write point:',err.message);
						}
						lastPosition = value.value;	// новая последняя позиция
						lastFix = Date.parse(timestamp);
						break;
					}
				});
			});
		} // end function doOnValue
	} // end function realDoLogging

	function doLogging(){
	// Отслеживает состояние navigation.trip.logging на предмет включения и выключения записи трека
	// И, собственно, включает и выключает
		const TPVsubscribe = {
			"context": "vessels.self",
			"subscribe": [
				{
					"path": "navigation.trip.logging",
					"format": "delta",
					"policy": "instant",
					"minPeriod": 0
				}
			]
		};
		app.subscriptionmanager.subscribe(	
			TPVsubscribe,	// подписка
			unsubscribesControl,	// массив функций отписки
			subscriptionError => {	// обработчик ошибки
				app.error('Error subscription to control:' + subscriptionError);
				app.setPluginError('Error subscription to control:'+subscriptionError.message);
			},
			doOnControl	// функция обработки каждой delta
		); // end subscriptionmanager

		function doOnControl(delta){	
		//
			delta.updates.forEach(update => {
				let timestamp = update.timestamp;	
				update.values.forEach(value => {	// здесь только navigation.trip.logging
					//app.debug('[doOnControl] value:',value,'getSelfPath:',app.getSelfPath('navigation.trip.logging.value'));
					switch(value.value.status){
					case true:
						//app.debug('Надо включить запись, если она ещё не включена');
						if(logging) return;	// запись уже включена
						//app.debug('Запись ещё не включена, value.logFile=',value.value.logFile,'options.trackDir=',options.trackDir);
						// Новый каталог для треков -- если передан
						if(value.value.logFile && (value.value.logFile !== options.trackDir)) {
							if(!value.value.logFile.endsWith('/')) value.value.logFile = path.dirname(value.value.logFile);
							if(value.value.logFile!=='.'){
								if(!value.value.logFile.startsWith('/')) value.value.logFile = path.resolve(__dirname,value.value.logFile);	// если путь не абсолютный -- сделаем абсолютным						
								//app.debug('Новый каталог для треков value.value.logFile=',value.value.logFile);
								options.trackDir = value.value.logFile;
								if(!fs.existsSync(options.trackDir)) fs.mkdirSync(options.trackDir, { recursive: true });
							}
						}
						switchOn();	// вклчаем запись трека
						break;
					case false:
						//app.debug('Надо выключить запись, logging=',logging,'routeSaveName=',routeSaveName);
						if(!routeSaveName) return;	// запись уже выключена
						//app.debug('Запись ещё не выключена');
						switchOff();	// выключаем запись трека
						break;
					default:	
					}
				});
			});
		}; // end function doOnControl		
	}; // end function doLogging

	function switchOn(){
		logging = openTrack();
		//app.debug('logging=',logging,'routeSaveName=',routeSaveName);
		if(logging) {// определим имя файла, запишем заголовки/допишем нужное, и, если ok -- запустим запись
			//updSKpath(logging,routeSaveName); 	// установим пути в SignalK, только это не работает в силу кривизны SignalK, нужен костыль.
			// Выполним обновление путей после того, как завершатся все "асинхронные" задачи на этом обороте планировщика.
			// Корпоративня многозадачность в стиле DOS в 21 веке -- это весело.
			// костыль к тому, что в SignalK обрабатывается сначала подписка, а потом дерево. 
			// setImmediate -- то же, что setTimeout(() => {}, 0), но NodeJS-специфично.
			setImmediate(()=>{updSKpath(logging,routeSaveName)});	
			realDoLogging();	// запустим собственно процесс записи трека
			app.debug('Log enabled');
			app.setPluginStatus('Log enabled, log file '+routeSaveName);
		}
		else {	// запись включить невозможно
			logging = false;
			//updSKpath(logging,routeSaveName);
			setImmediate(()=>{updSKpath(logging,routeSaveName)});
		}
		options.logging = logging;
		app.savePluginOptions(options, () => {app.debug('Options saved by Logging switch')});
	} // end function switchOn

	function switchOff(){
		unsubscribes.forEach(f => f());	// отписаться от всех подписок и всё остальное, что положили в unsubscribes
		unsubscribes = [];
		if(routeSaveName) closeTrack();	// запись могла и не начинаться, routeSaveName нет
		logging = false;
		routeSaveName = '';
		//updSKpath(logging,routeSaveName);
		setImmediate(()=>{updSKpath(logging,routeSaveName)});
		app.debug('Log disabled');
		app.setPluginStatus('Log disabled');
		options.logging = logging;
		app.savePluginOptions(options, () => {app.debug('Options saved by Logging switch')});
	} // end function switchOn



	function equirectangularDistance(from,to){
	// https://www.movable-type.co.uk/scripts/latlong.html
	// Но ещё проще на плоскости. Но надо ли?
	let lat1 = from.latitude;
	let lat2 = to.latitude;
	let lon1 = from.longitude;
	let lon2 = to.longitude;
	const φ1 = lat1 * Math.PI/180, φ2 = lat2 * Math.PI/180, Δλ = (lon2-lon1) * Math.PI/180, R = 6371e3;
	const x = Δλ * Math.cos((φ1+φ2)/2);
	const y = (φ2-φ1);
	const d = Math.sqrt(x*x + y*y) * R;	// метров
	return d;
	} // end function equirectangularDistance

	function tailCustom(filepath,lines) {
	//
		//app.debug('[tailCustom] filepath=',filepath);
		let data = false;
		try{
			//app.debug('tail -n '+lines+' "'+filepath+'"');
			data = cp.execSync('tail -n '+lines+' "'+filepath+'"',{encoding:'utf8'});
		}
		catch(err){
			app.debug('[tailCustom] False of read '+filepath,err.message);
		}
		return data;
	} // end function tailCustom

}; 	// end plugin.start

plugin.stop = function () {
	app.debug('plugin stopped, logging=',logging);	// options здесь нет
	// Сначала отписываемся от управляющей подписки, чтобы не сработало изменение navigation.trip.logging
	unsubscribesControl.forEach(f => f());
	unsubscribesControl = [];
	// Потом отписываемся от подписки на данные
	unsubscribes.forEach(f => f());
	unsubscribes = [];
	// Завершим gpx
	//if(routeSaveName) closeTrack();	// запись могла и не начинаться, routeSaveName нет
	// Потом обозначаем везде, что записи трека нет
	logging = false;
	//updSKpath(logging,routeSaveName);	// изменение navigation.trip.logging
	setImmediate(()=>{updSKpath(logging,routeSaveName)});
	app.setPluginStatus('Plugin stopped');
}; // end plugin.stop

function closeTrack(){
	app.debug('closeTrack',routeSaveName);
	const close = '		</trkseg>\n	</trk>\n</gpx>';
	try {
		fs.appendFileSync(routeSaveName, close);
	} 
	catch (err) {
		console.error(err.message);
		app.setPluginError('Unable close gpx:',err.message);
	}
} // end function closeTrack

function updSKpath(status=false,logFile=''){
	app.handleMessage(plugin.id, {
		context: 'vessels.self',
		updates: [
			{
				values: [
					{
						path: 'navigation.trip.logging',
						value: {
							status: status,
							logFile: logFile
						}
					}
				],
				source: { label: plugin.id },
				timestamp: new Date().toISOString(),
			}
		]
	});
} // end function updSKpath()


return plugin;
};
