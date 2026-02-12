@echo off
chcp 65001 >nul 2>nul

REM Mind Parliament - Double-click to start (Windows)
REM ==================================================

cd /d "%~dp0"

echo.
echo ==============================
echo    Mind Parliament Launcher
echo ==============================
echo.

REM Check for Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed.
    echo.
    echo Download it from: https://www.python.org/downloads/
    echo IMPORTANT: During installation, check the box that says
    echo "Add Python to PATH" at the bottom of the first screen.
    echo.
    pause
    exit /b 1
)

REM Load existing .env file if present
if exist .env (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        set "%%A=%%B"
    )
)

REM Check for API key
if "%ANTHROPIC_API_KEY%"=="" (
    echo No API key found. You need an Anthropic API key to use Mind Parliament.
    echo Get one at: https://console.anthropic.com/settings/keys
    echo.
    set /p ANTHROPIC_API_KEY="Paste your API key here and press Enter: "
)

if "%ANTHROPIC_API_KEY%"=="" (
    echo No key entered. Exiting.
    pause
    exit /b 1
)

REM Save API key to .env so they don't have to enter it again
echo ANTHROPIC_API_KEY=%ANTHROPIC_API_KEY%> .env
echo API key saved to .env file (you won't need to enter it again).
echo.

REM Install dependencies
echo Installing/checking dependencies...
python -m pip install -r requirements.txt --quiet
echo.

echo Starting Mind Parliament...
echo Opening http://localhost:8080 in your browser...
echo.
echo (Keep this window open. To stop the server, close this window.)
echo.

REM Open browser after a short delay
start "" http://localhost:8080

REM Start server
python server.py
