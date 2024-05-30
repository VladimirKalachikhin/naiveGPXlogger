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
		"title": "A minimum no fix timeout, sec",
		"description": "A new segment is created if there's no fix written for this interval.",
		"default": 15
	},
	"metadata":{
		"title": "",
		"description": "",
		"type": "object",
		"properties": {
			"desc": {
				"type": "string",
				"title": "File metadata"
			},
			"skipperName": {
				"type": "boolean",
				"title": "include skipperName from SignalK to metadata",
				"description": "",
				"default": false
			},
		}
	},
	"depthProp":{
		"title": "",
		"description": "Depth storing",
		"type": "object",
		"properties": {
			"enable": {
				"type": "boolean",
				"title": "Enable depth storing",
				"description": "Storing depth info to gpx file doubling it's size",
				"default": false
			},
			"feature":{
				"type": "string",
				"title": "Will be stored as Depth:",
				"enum": [
					"Depth below surface (DBS)",
					"Depth below keel (DBK)",
					"Depth below transducer (DBT)",
				],
				"default": "Depth below transducer (DBT)"
			},
			"fixDepth": {
				"type": "boolean",
				"title": "Trying to correct the depth to Depth below surface (DBS)",
				"default": true
			}
		}
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
	},
	"loggingOnMOB": {
		"type": "boolean",
		"title": "Start logging by MOB alarm",
		"description": "Start logging if the MOB alarm raised. If the MOB alarm is canceled, the log recording will continue anyway.",
		"default": false
	},
}
};

var unsubscribes = []; 	// массив функций, которые отписываются от подписки на координаты
var unsubscribesControl = [];	// от подписки на управление
var	routeSaveName=null; 	// 
var logging;	// текущее состояние записи трека
var beginGPX;	// заголовок файла gpx
var newLog = false;	// флаг что файл новый, для того, чтобы туда записали хотя бы одну точку
//var signalKperformanceFileName = 'signalKperformance.csv';	// имя файла со статистикой производительности, находится в trackDir, при отсутствии - сбор не производится.
//var signalKperformanceFileName = false;

plugin.start = function (options, restartPlugin) {
//
	//app.debug('__dirname=',__dirname);	
	//app.debug('options:',options);
	beginGPX = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="${plugin.name}"
		xmlns="http://www.topografix.com/GPX/1/1"  
		xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" 
		xmlns:gpxx="http://www8.garmin.com/xmlschemas/GpxExtensions/v3"
		xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd https://www8.garmin.com/xmlschemas/GpxExtensions/v3 https://www8.garmin.com/xmlschemas/GpxExtensions/v3/GpxExtensionsv3.xsd"
>
	<metadata>
`;
	if(options.metadata.desc) beginGPX += `	<desc>${options.metadata.desc}</desc>`;
	if(options.metadata.skipperName) {
		beginGPX += `		<author>
			<name>${app.getSelfPath("communication.skipperName")}</name>
			<email>${app.getSelfPath("communication.email")}</email>
		</author>`;
	}
	beginGPX += `
	</metadata>
	<trk>
		<trkseg>
`;
	// Глубина
	var depth;
	var depthFix;
	var depthProp;
	if(options.depthProp.feature.includes('DBS')) {
		depthProp = 'environment.depth.belowSurface';
		depthFix = 0;
	}
	else if(options.depthProp.feature.includes('DBK')) {
		depthProp = 'environment.depth.belowKeel';
		depthFix = app.getSelfPath('design.draft.value.maximum');
		if(!depthFix){
			let transducerToKeel = app.getSelfPath('environment.depth.transducerToKeel.value');
			let surfaceToTransducer = app.getSelfPath('environment.depth.surfaceToTransducer.value');
			if(transducerToKeel && surfaceToTransducer) depthFix = transducerToKeel + surfaceToTransducer;
		}
	}
	else if(options.depthProp.feature.includes('DBT')) {
		depthProp = 'environment.depth.belowTransducer';
		depthFix = app.getSelfPath('environment.depth.surfaceToTransducer.value');
		if(!depthFix){
			let draft = app.getSelfPath('design.draft.value.maximum');
			let transducerToKeel = app.getSelfPath('environment.depth.transducerToKeel.value');
			if(transducerToKeel && draft) depthFix = draft - transducerToKeel;
		}
	}
	//app.debug('depthProp=',depthProp,'depthFix=',depthFix);
	
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
	//app.debug('plugin started, now logging is',logging,'log dir is',options.trackDir);
	app.setPluginStatus(`Started, now 'logging' setted to ${logging}, log dir is ${options.trackDir}, ready to recording.`);
	// app.subscriptionmanager возвращает что-то при подписке?
	//app.debug('Initializing SignalK path ');
	//app.debug('Starting updSKpath in plugin.start ');
	updSKpath(logging,routeSaveName); 	// установим пути в SignalK согласно options.logging, однако routeSaveName ещё неизвестно, оно устанавливается в openTrack()
	//process.nextTick(()=>{updSKpath(logging,routeSaveName)});	// https://nodejs.org/en/learn/asynchronous-work/understanding-processnexttick https://nodejs.org/en/learn/asynchronous-work/understanding-setimmediate
	logging = false;	// укажем, что на самом деле запись трека не происходит
	//app.debug('Start, logging=',logging,'navigation.trip.logging.value',app.getSelfPath('navigation.trip.logging.value'));
	
	// Запустить doLogging нужно гарантированно после отрабатывания updSKpath выше,
	// а оно, ...., асинхронное. Если updSKpath не успеет отработать до запуска doLogging,
	// логирование не включится вообще, потому что не на что будет подписываться.
	setImmediate(()=>{doLogging()});	// запустим в следующем обороте
	//setTimeout(() => {doLogging()}, 5000);
	//doLogging();	// запустим отслеживание включения и выключения записи трека, и будем это включать/выключать	

	return;		// конец содержательной части plugin.start
	
	
	
	// Объявления функций

	function doLogging(){
	// Отслеживает состояние navigation.trip.logging на предмет включения и выключения записи трека
	// И, собственно, включает и выключает. Т.е., делает всю содержательную работу
	
		//let res = app.getSelfPath('navigation.trip.logging');
		//app.debug('[doLogging] is navigation.trip.logging present?',res);
	
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
		if(options.loggingOnMOB){
			TPVsubscribe.subscribe.push({
				"path": "notifications.mob",
				"format": "delta",
				"policy": "instant",
				"minPeriod": 0
			});
		};
		//app.debug('[doLogging] Subscribing to navigation.trip.logging via app.subscriptionmanager.subscribe by send',JSON.stringify(TPVsubscribe));
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
		//app.debug('[doLogging] Subscribed to navigation.trip.logging');

		function doOnControl(delta){	
		// Вызывается на каждое событие по подписке на состояние записи трека
			//app.debug('[doOnControl] navigation.trip.logging event fired!');

			for(const update of delta.updates) {
				//app.debug(update);
				if(!update.values) continue;	// там может быть обновление meta, а не данных
				let timestamp = update.timestamp;	
				update.values.forEach(value => {	// здесь только navigation.trip.logging
					//app.debug('[doOnControl] value:',value,'getSelfPath:',app.getSelfPath('navigation.trip.logging.value'));
					switch(value.path){
					case "navigation.trip.logging":
						switch(value.value.status){
						case true:
							//app.debug('Надо включить запись, если она ещё не включена');
							if(logging) return;	// запись уже включена
							//app.debug('[doOnControl] Recording is not enabled yet, value.logFile=',value.value.logFile,'options.trackDir=',options.trackDir);
							// Новый каталог для треков -- если передан. Это обязательно путь - с / в конце
							if(value.value.logFile && value.value.logFile.endsWith('/')) {
								if(value.value.logFile !== options.trackDir) {	// присланный в рассылке каталог не тот, что в конфиге
									if(!value.value.logFile.startsWith('/')) value.value.logFile = path.join(__dirname,value.value.logFile);	// если путь не абсолютный -- сделаем абсолютным						
									//app.debug('Новый будущий каталог для треков value.value.logFile=',value.value.logFile);
									if(createDir(value.value.logFile)) {	// создадим каталог
										options.trackDir = value.value.logFile;	// сменим каталог
									}
									else {
										app.debug('Cannot set a new directory for track recording, the old one is used. New:',value.value.logFile,'Old:',options.trackDir);
										app.setPluginError('Cannot set a new directory for track recording, the old one is used. New:',value.value.logFile,'Old:',options.trackDir);
									}
								}
							}
							switchOn();	// вклчаем запись трека
							break;
						case false:
							//app.debug('[doOnControl] Need to turn off the recording, logging=',logging,'routeSaveName=',routeSaveName);
							if(routeSaveName == null) return;	// запись уже выключена
							//app.debug('Recording is not turned off yet, turning off');
							switchOff();	// выключаем запись трека
							break;
						default:	
							app.debug('[doOnControl] strange value of navigation.trip.logging:',value);
						};
						break;
					case "notifications.mob":
						//app.debug('[doOnControl] MOB case:',value.value);
						if(!options.loggingOnMOB) break;
						// Похоже, что автор Freeboard-SK индус. В любом случае - он дебил, и
						// разницы между выключением режима и сменой режима не видит.
						// Поэтому он выключает режим MOB установкой value.state = "normal"
						// вместо value = null, как это указано в документации.
						if(value.value && (value.value.state != "normal")){	// режим MOB есть (причём именно сейчас включен?).
							//app.debug('Надо включить запись, если она ещё не включена');
							if(logging) return;	// запись уже включена
							switchOn();	// вклчаем запись трека
						}
						else {	// режим MOB отсутствует (не обязательно вот только выключен)
							// Полагаю, что не надо выключать запись пути, если она была включена по MOB
							// Кроме того, нужно отслеживать, не была ли запись включена до, не выключили ли
							// её уже, и всё такое.
						}
						break;
					};
				});
			};
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
			//app.debug('Start updSKpath in switchOn, if recorging possible ');
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
		app.savePluginOptions(options, () => {
				//app.debug('Options saved by Logging switch on');
			});
	} // end function switchOn

	function switchOff(){
		unsubscribes.forEach(f => f());	// отписаться от всех подписок и всё остальное, что положили в unsubscribes
		unsubscribes = [];
		if(routeSaveName !== null) closeTrack();	// запись могла и не начинаться, routeSaveName нет
		logging = false;
		routeSaveName = null;
		//app.debug('Start updSKpath in switchOff ');
		setImmediate(()=>{updSKpath(logging,routeSaveName)});	// обновим SignalK после завершения текущего оборота корпоративной многозадачности
		app.debug('Log disabled');
		app.setPluginStatus('Log disabled');
		options.logging = logging;
		app.savePluginOptions(options, () => {
				//app.debug('Options saved by Logging switch off');
			});
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

	//app.debug('[openTrack] routeSaveName before update path=',routeSaveName);
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
		if(options.depthProp.enable){
			TPVsubscribe.subscribe.push({
				"path": depthProp,
				"format": "delta",
				"policy": "instant",
				"minPeriod": options.trackFrequency
			});
		}
		//app.debug('TPVsubscribe:',TPVsubscribe);
		// документации на эту штуку так и нет, но удалось узнать, что вызывать это можно много раз с разными подписками
		//app.debug('[realDoLogging] Subscribing to navigation.position via app.subscriptionmanager.subscribe by send',JSON.stringify(TPVsubscribe));
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
		//app.debug('[realDoLogging] Subscribed to navigation.position');

		function doOnValue(delta){	
			//
			// Новый трек каждый день
			if(options.everyDay){
				//if((new Date(lastFix).getMinutes()-new Date().getMinutes()) != 0){	// каждую минуту
				if((new Date(lastFix).getDate()-new Date().getDate()) != 0){	//
					switchOff();
					switchOn();
					app.debug('Opened new track by new day');
					app.setPluginStatus('Opened new track by new day');
				}
			}

			for(const update of delta.updates) {
				//app.debug(update);
				if(!update.values) continue;	// там может быть обновление meta, а не данных
				let timestamp = update.timestamp;	
				update.values.forEach(value => {	// если подписка только на координаты -- здесь будут только координаты
					//app.debug('[doOnValue] value:',value);
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
						// Здесь в каждую точку записывается глубина вне зависимости от того,
						// когда она была получена. Правильно ли это?
						if(options.depthProp.enable && (depth !== undefined)){
							//app.debug('Записана depth=',depth);
							trkpt += `				<extensions>
					<gpxx:TrackPointExtension>
						<gpxx:Depth>${depth}</gpxx:Depth>
					</gpxx:TrackPointExtension>
				</extensions>
`;
							// Однако, так глубина записывается только в точку, создаваемую
							// сразу после получения глубины.
							// в остальные точки до следующего получения глубины глубина не пишется.
							depth = undefined;
						}
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
						/*/ Тест производительности SignalK
						if(signalKperformanceFileName){
							let timeNow = new Date();
							let timestampDate = new Date(timestamp);
							let signalKperformance = `${timestamp},${timeNow.toISOString()},${(timeNow.getTime()-timestampDate.getTime())/1000}\n`;
							let realsignalKperformanceFileName = path.join(options.trackDir,signalKperformanceFileName);	// абсолютный путь, потому что каталог -- всегда абсолютный
							try {
								fs.appendFileSync(realsignalKperformanceFileName, signalKperformance);
							} 
							catch (err) {
								console.error('[doOnValue]',err.message);
							}
						}
						/*/ 
						newLog = false;
						lastPosition = value.value;	// новая последняя позиция
						lastFix = Date.parse(timestamp);
						break;
					case depthProp:
						depth = Math.round(value.value*100)/100;
						if(options.depthProp.fixDepth && (depthFix !== undefined)) depth += depthFix;
						//app.debug('Получена depth=',depth);
						break;
					}
				});
			};
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
			app.setPluginError('[tailCustom] False of read '+filepath,err.message);
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
	//app.debug('plugin stopped, logging=',logging);	// options здесь нет
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
	// здесь updSKpath _обязательно_ должен выполнится на этом обороте, иначе
	// если на следующем, то оно может выполнится _после_ того вызова updSKpath, который
	// включает запись (но может и до). Тогда запись не включится.
	//app.debug('Start updSKpath in plugin.stop ');
	updSKpath(logging,routeSaveName);	// изменение navigation.trip.logging
	//setImmediate(()=>{updSKpath(logging,routeSaveName)});	// изменение navigation.trip.logging
	app.setPluginStatus('Plugin stopped');
}; // end plugin.stop

function closeTrack(){
	//app.debug('closeTrack',routeSaveName);
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
	let delta = {
		"context": "vessels.self",
		"updates": [
			{
				"values": [
					{
						"path": "navigation.trip.logging",
						"value": {
							"status": status,
							"logFile": logFile
						}
					}
				],
				"source": { "label": plugin.id },
				"timestamp": new Date().toISOString(),
			}
		]
	};
	//app.debug('[updSKpath] by app.handleMessage sended:',JSON.stringify(delta));
	app.handleMessage(plugin.id,delta);
} // end function updSKpath()


return plugin;
};
