#!/usr/bin/env bash
# ================================================================
#        Hermes Agent - Config Deck (Linux / macOS)
# ================================================================

set -e

# Switch to project root folder
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "================================================================"
echo "          Hermes Agent - Config Deck (Linux/macOS)              "
echo "================================================================"
echo ""

# 1. Check Python 3 runtime
if command -v python3 >/dev/null 2>&1; then
    PY_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PY_BIN="python"
else
    echo "[ERROR] Python 3 is not installed or not in your PATH."
    echo ""
    echo "Please install Python 3:"
    echo "  Ubuntu/Debian: sudo apt update && sudo apt install python3 python3-pip"
    echo "  Arch Linux:    sudo pacman -S python python-pip"
    echo "  macOS:         brew install python"
    echo ""
    exit 1
fi

# 2. Check PyYAML dependency
if ! "$PY_BIN" -c "import yaml" >/dev/null 2>&1; then
    echo "[INFO] PyYAML dependency is missing. Installing automatically..."
    "$PY_BIN" -m pip install --upgrade pyyaml || {
        echo "[ERROR] Could not install PyYAML automatically."
        echo "Please install it manually: pip3 install pyyaml or sudo apt install python3-yaml"
        exit 1
    }
    echo "[OK] PyYAML installed successfully."
    echo ""
fi

# 3. Launch server
exec "$PY_BIN" server.py "$@"
