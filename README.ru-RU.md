[In English](https://github.com/VladimirKalachikhin/naiveGPXlogger/blob/master/README.md)  
# naiveGPXlogger для SignalK [![License: CC BY-SA 4.0](https://img.shields.io/badge/License-CC%20BY--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-sa/4.0/)


## v. 0.1
Плагин для SignalK, простое средство для записи потока координат в файл [.gpx](https://www.topografix.com/gpx.asp)

## Возможности
* запись точек через указанный интервал времени, или по мере получения координат
* запись точек через указанное расстояние
* создание нового сегмента при потере координат дольше указанного времени
* запись всего пути путешествия в один файл или создание отдельных файлов каждый день
* запись глубины (в формате [Garmin extension](https://www8.garmin.com/xmlschemas/GpxExtensions/v3/GpxExtensionsv3.xsd), в gpx своего способа сохранения информации о глубине не предусмотрено)
* при перезапуске сервера запись пути продолжится

## Использование
## пользователем
Включить запись можно в веб-интерфейсе SignalK на странице настроек плагина в меню "Plugin Config".  
Картплотер [GaladrielMap](https://www.npmjs.com/package/galadrielmap_sk) может показывать записываемый файл по мере записи и имеет средства управления записью в своём интерфейсе.

## программистом
naiveGPXlogger создаёт путь **navigation.trip.logging** в модели данных SignalK. По этому пути находится значение

```
{
  "status": boolean,   
  "logFile": "full/log/file/name"
}
```

где "status" -- это состояние записи: записывается или нет; а "logFile" -- полное имя записываемого файла в файловой системе сервера.  
Для включения записи нужно изменить этот путь путём посылки _delta_, указав `"status": true` Если при этом указать в "logFile" путь к каталогу (со слешем в конце) -- файл будет создан в этом каталоге.  
Выключается запись посылкой _delta_ с `"status": false`  
Базовый пример управления записью есть в файле sample.html

## Установка и конфигурирование
С помощью веб-интерфейса SignalK установите расширение из  SignalK Appstore как **naivegpxlogger** обычным образом.  
Перезапустите SignalK  
В меню Server -> Plugin Config сервера SignalK укажите запуск расширения при старте сервера и сделайте необходимые настройки.

## Поддержка

[Форум](https://github.com/VladimirKalachikhin/Galadriel-map/discussions)

Форум будет живее, если вы сделаете пожертвование на [ЮМани](https://sobe.ru/na/galadrielmap).

Вы можете получить [индивидуальную платную консультацию](https://kwork.ru/training-consulting/20093293/konsultatsii-po-ustanovke-i-ispolzovaniyu-galadrielmap) по вопросам установки и использования всех продуктов для [GaladrielMap](https://www.npmjs.com/package/galadrielmap_sk).
