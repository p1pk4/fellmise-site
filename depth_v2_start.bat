@echo off
chcp 65001 >nul
setlocal
set PORT=8878
cd /d "%~dp0"

echo.
echo   FELLMISE - depth journey v2 (прототип маршрута по шести сценам)
echo   ------------------------------------------------------------
echo   НЕ ЗАКРЫВАЙ ЭТО ОКНО, ПОКА СМОТРИШЬ.
echo   Крути колесо вниз - движение внутрь мира, вверх - обратно.
echo   Отладка: http://localhost:%PORT%/depth-v2/?debug=1
echo   Продакшен не трогается: только чтение файлов.
echo   ------------------------------------------------------------
echo.

if not exist "out\depth-v2\planes\index.json" (
    echo   планов глубины нет - собираю из принятых мастеров...
    python depth-v2\build_planes.py
    if errorlevel 1 (
        echo   [!] не собралось. Нужен python с Pillow и numpy.
        pause
        exit /b 1
    )
)

rem порт мог остаться занятым от прошлого запуска - освобождаем
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%PORT% "') do (
    echo   освобождаю порт %PORT% ^(процесс %%p^)
    taskkill /f /pid %%p >nul 2>&1
)

echo   поднимаю сервер на порту %PORT%...
start "" /b cmd /c "node tests\browser\lib\server.mjs --root . --port %PORT%"

set /a TRIES=0
:wait
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr /r /c:"LISTENING" | findstr ":%PORT% " >nul
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% lss 15 goto wait
echo   [!] сервер не поднялся за 15 секунд. Запустите вручную:
echo       node tests\browser\lib\server.mjs --root . --port %PORT%
pause
exit /b 1

:ready
echo   готово, открываю браузер.
start "" "http://localhost:%PORT%/depth-v2/"
echo.
echo   Закрыть прототип: закройте это окно или нажмите любую клавишу.
pause >nul

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%PORT% "') do taskkill /f /pid %%p >nul 2>&1
endlocal
