#!/bin/bash

# Mind Parliament - Double-click to start
# ========================================

# Go to the folder this script lives in
cd "$(dirname "$0")"

echo ""
echo "=============================="
echo "   Mind Parliament Launcher"
echo "=============================="
echo ""

# Check for Python 3
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed."
    echo "Download it from: https://www.python.org/downloads/"
    echo ""
    echo "Press any key to close..."
    read -n 1
    exit 1
fi

# Check for .env file with API key
if [ -f .env ]; then
    source .env
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "No API key found. You need an Anthropic API key to use Mind Parliament."
    echo "Get one at: https://console.anthropic.com/settings/keys"
    echo ""
    echo "Paste your API key here and press Enter:"
    read -r API_KEY
    if [ -z "$API_KEY" ]; then
        echo "No key entered. Exiting."
        echo "Press any key to close..."
        read -n 1
        exit 1
    fi
    export ANTHROPIC_API_KEY="$API_KEY"
    # Save it so they don't have to enter it again
    echo "ANTHROPIC_API_KEY=$API_KEY" > .env
    echo ""
    echo "API key saved to .env file (you won't need to enter it again)."
fi

# Install dependencies if needed
if ! python3 -c "import anthropic, fastapi, uvicorn" 2>/dev/null; then
    echo ""
    echo "Installing dependencies (first time only)..."
    pip3 install -r requirements.txt
    echo ""
fi

echo ""
echo "Starting Mind Parliament..."
echo "Opening http://localhost:8080 in your browser..."
echo ""
echo "(Keep this window open. To stop the server, close this window.)"
echo ""

# Open browser after a short delay
(sleep 2 && open "http://localhost:8080") &

# Start server
python3 server.py
