@echo off
rem One-click launcher for 3D Flashcard Studio (Windows).
rem Installs dependencies and builds the app the first time, then serves it at http://localhost:3000
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install
  if errorlevel 1 ( echo npm install failed. & pause & exit /b 1 )
)

if not exist out\index.html (
  echo Building the app - first run only...
  call npm run build
  if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
)

echo.
echo 3D Flashcard Studio is starting at http://localhost:3000
echo Close this window to stop it.
start "" http://localhost:3000
node scripts\serve-out.mjs 3000
