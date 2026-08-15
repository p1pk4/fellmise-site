@echo off
chcp 65001 >nul
setlocal
set PORT=8899
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

echo.
echo   FELLMISE - редактор сцен
echo   ------------------------------------------------------------
echo   НЕ ЗАКРЫВАЙ ЭТО ОКНО, ПОКА РАССТАВЛЯЕШЬ.
echo   Закроешь окно - сервер умрёт, и кнопка Export перестанет
echo   сохранять в assets\layout.json (останется только скачивание).
echo   ------------------------------------------------------------
echo.

rem порт мог остаться занятым от прошлого запуска - освобождаем
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%PORT% "') do (
    echo   освобождаю порт %PORT% ^(процесс %%p^)
    taskkill /f /pid %%p >nul 2>&1
)

if not exist "next\index.html" (
    echo   [!] нет next\ - сайт не собран.
    echo       cd journey3 ^&^& npm ci ^&^& npx vite build
    echo       python tools\build_journey3.py deploy
    echo.
    pause
    exit /b 1
)

echo   поднимаю сервер на порту %PORT%...
start "" /b cmd /c "python tools\editor_serve.py --port %PORT%"

rem ждём, пока порт начнёт слушать, но не дольше 15 секунд
set /a TRIES=0
:wait
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr /r /c:"LISTENING" | findstr ":%PORT% " >nul
if not errorlevel 1 goto ready
set /a TRIES+=1
if %TRIES% lss 15 goto wait
echo   [!] сервер не поднялся за 15 секунд. Запустите вручную:
echo       python tools\editor_serve.py --port %PORT%
pause
exit /b 1

:ready
echo   готово, открываю браузер.
start "" "http://localhost:%PORT%/next/?editor=1"
echo.
echo   Расставили - нажмите Export в панели справа.
echo   Чтобы увидеть результат на сайте:
echo       cd journey3 ^&^& npx vite build ^&^& cd ..
echo       python tools\build_journey3.py deploy
echo.
echo   Закрыть редактор: закройте это окно или нажмите любую клавишу.
pause >nul

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr ":%PORT% "') do taskkill /f /pid %%p >nul 2>&1
endlocal
