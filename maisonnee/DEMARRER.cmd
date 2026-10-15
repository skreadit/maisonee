@echo off
setlocal
cd /d "%~dp0"
echo Maisonnee - demonstration locale
echo.
set "MAISONNEE_NODE_DIR=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
if exist "%MAISONNEE_NODE_DIR%\node.exe" set "PATH=%MAISONNEE_NODE_DIR%;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo Installez Node.js 24 puis relancez ce fichier.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);if(v[0]<22||(v[0]===22&&v[1]<12)){console.error('Node.js 24 recommande, version 22.12 minimum.');process.exit(1)}"
if errorlevel 1 (
  pause
  exit /b 1
)
if not exist ".env.local" copy ".env.example" ".env.local" >nul
if not exist "node_modules\next\package.json" (
  echo Installation initiale des dependances...
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Ouvrez http://127.0.0.1:3000 dans votre navigateur.
echo Gardez cette fenetre ouverte. Ctrl+C arrete le serveur.
call npm.cmd run dev
pause
