@echo off
set "APP_DIR=%~dp0"
set "ELECTRON=%APP_DIR%node_modules\electron\dist\electron.exe"

if not exist "%ELECTRON%" (
  echo Electron not found: "%ELECTRON%"
  echo Please run npm install first.
  pause
  exit /b 1
)

if not exist "%APP_DIR%dist-electron\main.js" (
  echo App entry not found: "%APP_DIR%dist-electron\main.js"
  echo Please run npm run build first.
  pause
  exit /b 1
)

start "" /D "%APP_DIR%" "%ELECTRON%" .
