module.exports = function (app) {
const fs = require('fs');
const events = require('events');
const path = require('path');
const cp = require('child_process');

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
var	routeSaveName=null; 	// 
var logging;	// текущее состояние записи трека
var beginGPX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx xmlns="http://www.topografix.com/GPX/1/1"  creator="${plugin.name}" version="1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
	<metadata>
	</metadata>
	<trk>
		<trkseg>
`;
var newLog = false;	// флаг что файл новый, для того, чтобы туда записали хотя бы одну точку

plugin.start = function (options, restartPlugin) {
//
	//app.debug('__dirname=',__dirname);
	
	// Установка умолчального значения каталога для записи лога
	if(!options.trackDir) options.trackDir = 'track';
	if(options.trackDir[0]!='/') options.trackDir = path.join(__dirname,options.trackDir);	// если путь не абсолютный -- сделаем абсолютным
	//app.debug('options.trackDir=',options.trackDir);
	// Создание каталога для записи лога
	if(!createDir(options.trackDir)) {
		plugin.stop();
		return;
	}

	logging = options.logging;
	app.debug('plugin started, now logging is',logging,'log dir is',options.trackDir);
	app.setPluginStatus(`Started, now 'logging' setted to ${logging}, log dir is ${options.trackDir}, ready to recording.`);
	updSKpath(logging,routeSaveName); 	// установим пути в SignalK согласно options.logging, однако routeSaveName ещу неизвестно, оно устанавливается в openTrack()
	logging = false;	// укажем, что на самом деле запись трека не происходит
	//app.debug('Start, logging=',logging,'navigation.trip.logging.value',app.getSelfPath('navigation.trip.logging.value'));
	
	doLogging();	// запустим отслеживание включения и выключения записи трека, и будем это включать/выключать	

	return;		// конец содержательной части plugin.start
	
	
	
	// Объявления функций

	function doLogging(){
	// Отслеживает состояние navigation.trip.logging на предмет включения и выключения записи трека
	// И, собственно, включает и выключает. Т.е., делает всю содержательную работу
	
		// В первую очередь подпишемся на состояние записи трека
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
		app.subscriptionmanager.subscribe(	// собственно процесс подписывания
			TPVsubscribe,	// подписка
			unsubscribesControl,	// массив функций отписки
			subscriptionError => {	// обработчик ошибки
				//app.error('Error subscription to control:' + subscriptionError);
				app.debug('Error subscription to control:' + subscriptionError);
				app.setPluginError('Error subscription to control:'+subscriptionError.message);
			},
			doOnControl	// функция обработки каждой delta
		); // end subscriptionmanager

		function doOnControl(delta){	
		// Вызывается на каждое событие по подписке на состояние записи трека
			delta.updates.forEach(update => {
				let timestamp = update.timestamp;	
				update.values.forEach(value => {	// здесь только navigation.trip.logging
					//app.debug('[doOnControl] value:',value,'getSelfPath:',app.getSelfPath('navigation.trip.logging.value'));
					switch(value.value.status){
					case true:
						//app.debug('Надо включить запись, если она ещё не включена');
						if(logging) return;	// запись уже включена
						//app.debug('Запись ещё не включена, value.logFile=',value.value.logFile,'options.trackDir=',options.trackDir);
						// Новый каталог для треков -- если передан. Это обязательно путь - с / в конце
						if(value.value.logFile && value.value.logFile.endsWith('/')) {
							if(value.value.logFile !== options.trackDir) {	// присланный в рассылке каталог не тот, что в конфиге
								if(!value.value.logFile.startsWith('/')) value.value.logFile = path.join(__dirname,value.value.logFile);	// если путь не абсолютный -- сделаем абсолютным						
								//app.debug('Новый будущий каталог для треков value.value.logFile=',value.value.logFile);
								if(createDir(value.value.logFile)) {	// создадим каталог
									options.trackDir = value.value.logFile;	// сменим каталог
								}
								else app.debug('Cannot set a new directory for track recording, the old one is used. New:',value.value.logFile,'Old:',options.trackDir);
							}
						}
						switchOn();	// вклчаем запись трека
						break;
					case false:
						//app.debug('Надо выключить запись, logging=',logging,'routeSaveName=',routeSaveName);
						if(routeSaveName == null) return;	// запись уже выключена
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
		//app.debug('[switchOn] logging=',logging,'routeSaveName=',routeSaveName);
		if(logging) {// определим имя файла, запишем заголовки/допишем нужное, и, если ok -- запустим запись
			//updSKpath(logging,routeSaveName); 	// установим пути в SignalK, только это не работает в силу кривизны SignalK, нужен костыль.
			// Выполним обновление путей после того, как завершатся все "асинхронные" задачи на этом обороте планировщика.
			// Корпоративня многозадачность в стиле DOS в 21 веке -- это весело.
			// костыль к тому, что в SignalK обрабатывается сначала подписка, а потом дерево. 
			// setImmediate -- то же, что setTimeout(() => {}, 0), но NodeJS-специфично.
			setImmediate(()=>{updSKpath(logging,routeSaveName)});	
			realDoLogging();	// запустим собственно процесс записи трека: подпишемся, назначим обработчики и станем писать.
			app.debug('Log enabled, log file '+routeSaveName);
			app.setPluginStatus('Log enabled, log file '+routeSaveName);
		}
		else {	// запись включить невозможно
			logging = false;
			app.debug('Log disabled by return false from openTrack()');
			app.setPluginStatus('Log disabled. Recording cannot be enabled due to the inability to open the file '+routeSaveName);
			//setImmediate(()=>{updSKpath(logging,routeSaveName)});
			plugin.stop();
			return;
		}
		options.logging = logging;
		app.savePluginOptions(options, () => {app.debug('Options saved by Logging switch')});
	} // end function switchOn

	function switchOff(){
		unsubscribes.forEach(f => f());	// отписаться от всех подписок и всё остальное, что положили в unsubscribes
		unsubscribes = [];
		if(routeSaveName !== null) closeTrack();	// запись могла и не начинаться, routeSaveName нет
		logging = false;
		routeSaveName = null;
		setImmediate(()=>{updSKpath(logging,routeSaveName)});	// обновим SignalK после завершения текущего оборота корпоративной многозадачности
		app.debug('Log disabled');
		app.setPluginStatus('Log disabled');
		options.logging = logging;
		app.savePluginOptions(options, () => {app.debug('Options saved by Logging switch')});
	} // end function switchOff

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
			// записать хотя бы одну точку в сегмент. Нужно ли это, если точка такая же, как последняя в 
			// предыдущем сегменте? Иначе -- запишется пустой сегмент. И ладно.
			//newLog = true;	
			break;
		}
	}
	else {
		gpxtrack = beginGPX;
		newLog = true;
	}
	//app.debug(routeSaveName,'gpxtrack:',gpxtrack);

	routeSaveName = path.join(options.trackDir,routeSaveName);	// абсолютный путь, потому что каталог -- всегда абсолютный
	try {
		fs.appendFileSync(routeSaveName, gpxtrack);
	} 
	catch (err) {
		console.error('[openTrack]',err.message);
		app.setPluginError('Unable logging: '+err.message);
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
				app.debug('Error subscription to data:' + subscriptionError);
				//app.error('Error subscription to data:' + subscriptionError); 	// реально то же самое, что и app.debug, но без выделения цветом
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
						//app.debug('equirectangularDistance=',equirectangularDistance(lastPosition,value.value),'options.minmove=',options.minmove);
						// в файле есть хотя бы одна точка, и расстояние от предыдущей до текущей меньше указанного
						if(!newLog && (equirectangularDistance(lastPosition,value.value)<options.minmove)) {
							lastFix = Date.parse(timestamp);
							return;
						}
						let trkpt = '			<trkpt ';
						trkpt += `lat="${value.value.latitude}" lon="${value.value.longitude}">\n`;
						trkpt += `				<time> ${timestamp} </time>\n`;
						trkpt += '			</trkpt>\n';
						// если долго не было координат -- сначала завершим сегмент
						if((Date.parse(timestamp)-lastFix)>(options.trackTimeout*1000)) trkpt = '		</trkseg>\n		<trkseg>\n' + trkpt;	
						//app.debug('trkpt:',trkpt);
						try {
							fs.appendFileSync(routeSaveName, trkpt);
						} 
						catch (err) {
							console.error('[doOnValue]',err.message);
							app.setPluginError('Unable write point: '+err.message);
						}
						newLog = false;
						lastPosition = value.value;	// новая последняя позиция
						lastFix = Date.parse(timestamp);
						break;
					}
				});
			});
		} // end function doOnValue
	} // end function realDoLogging



	function equirectangularDistance(from,to){
	// https://www.movable-type.co.uk/scripts/latlong.html
	// from,to: {longitude: xx, latitude: xx}
	const rad = Math.PI/180;
	const φ1 = from.latitude * rad;
	const φ2 = to.latitude * rad;
	const Δλ = (to.longitude-from.longitude) * rad;
	const R = 6371e3;	// метров
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
	
	function createDir(dir){
	// создаёт указанный каталог, если его нет
	// а если есть -- проверяет на права
	// возвращает bool
		let res = true;
		if(fs.existsSync(dir)){
			try{
				fs.accessSync(dir,fs.constants.R_OK | fs.constants.W_OK);
			}
			catch(error){
				app.debug('[createDir]',error.message);
				app.setPluginError(`No rights to directory ${dir}`);
				res = false;
			}
		}
		else{
			try{
				fs.mkdirSync(dir,{recursive:true});
			}
			catch(error){
				switch(error.code){
				case 'EACCES':	// Permission denied
				case 'EPERM':	// Operation not permitted
					app.debug(`False to create ${dir} by Permission denied`);
					app.setPluginError(`False to create ${dir} by Permission denied`);
					res = false;
					break;
				case 'ETIMEDOUT':	// Operation timed out
					app.debug(`False to create ${dir} by Operation timed out`);
					app.setPluginError(`False to create ${dir} by Operation timed out`);
					res = false;
					break;
				}
			}
		}
		return res;
	} // end function createDir

}; 	// end plugin.start

plugin.stop = function () {
	app.debug('plugin stopped, logging=',logging);	// options здесь нет
	// Сначала отписываемся от управляющей подписки, чтобы не сработало изменение navigation.trip.logging
	unsubscribesControl.forEach(f => f());
	unsubscribesControl = [];
	// Потом отписываемся от подписки на данные
	unsubscribes.forEach(f => f());
	unsubscribes = [];
	// Завершим gpx.
	// а надо? При следующем запуске файл продолжится...
	//if(routeSaveName!==null) closeTrack();	// запись могла и не начинаться, routeSaveName нет
	// Потом обозначаем везде, что записи трека нет
	logging = false;
	setImmediate(()=>{updSKpath(logging,routeSaveName)});	// изменение navigation.trip.logging
	app.setPluginStatus('Plugin stopped');
}; // end plugin.stop

function closeTrack(){
	app.debug('closeTrack',routeSaveName);
	if(fs.existsSync(routeSaveName)){
		const close = '		</trkseg>\n	</trk>\n</gpx>';
		try {
			fs.appendFileSync(routeSaveName, close);
		} 
		catch (err) {
			console.error('[closeTrack]',err.message);
			app.setPluginError('Unable close gpx: '+err.message);
		}
	}
} // end function closeTrack

function updSKpath(status=false,logFile=''){
	if(status) status = true;	// никогда не должно быть, чтобы status не был boolean, но...
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
