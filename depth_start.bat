@echo off
chcp 65001 >nul
setlocal
set PORT=8877
cd /d "%~dp0"

echo.
echo   FELLMISE - depth dive (прототип village to forest)
echo   ------------------------------------------------------------
echo   НЕ ЗАКРЫВАЙ ЭТО ОКНО, ПОКА СМОТРИШЬ.
echo   Крути колесо вниз - падение в лес, вверх - обратно.
echo   Отладка: http://localhost:%PORT%/depth/?debug=1
echo   Ничего в продакшене не трогается: только чтение файлов.
echo   ------------------------------------------------------------
echo.

rem порт мог остаться занятым от прошлого запуска - освобождаем
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%PORT% "') do (
    echo   освобождаю порт %PORT% ^(процесс %%p^)
    taskkill /f /pid %%p >nul 2>&1
)

echo   поднимаю сервер на порту %PORT%...
start "" /b cmd /c "node tests\browser\lib\server.mjs --root . --port %PORT%"

rem ждём, пока порт начнёт слушать, но не дольше 15 секунд
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
start "" "http://localhost:%PORT%/depth/"
echo.
echo   Закрыть прототип: закройте это окно или нажмите любую клавишу.
pause >nul

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%PORT% "') do taskkill /f /pid %%p >nul 2>&1
endlocal
