#!/usr/bin/env bash
# Stops a previously running Hermes Config Deck started from THIS folder.
#
# A failed in-app update can leave a detached server running without a visible
# terminal. Because it still holds the port, relaunching would produce two
# decks answering the same address. This script clears that orphan.
#
# It never guesses. The server records its pid in .deck-pid, and every
# candidate is verified before being touched:
#   1. the pid must come from .deck-pid written by this folder's server
#   2. that pid must still be alive
#   3. its command line must reference a python interpreter AND server.py
# An unrelated Python program can therefore never be a candidate, even if it
# happens to reuse a pid.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.deck-pid"

[ -f "$PID_FILE" ] || exit 0

DECK_PID="$(head -n 1 "$PID_FILE" 2>/dev/null | tr -d '[:space:]')"
case "$DECK_PID" in
    ''|*[!0-9]*) rm -f "$PID_FILE"; exit 0 ;;
esac

[ "$DECK_PID" = "$$" ] && exit 0

if ! kill -0 "$DECK_PID" 2>/dev/null; then
    # Stale file from a deck that already exited.
    rm -f "$PID_FILE"
    exit 0
fi

CMD="$(ps -p "$DECK_PID" -o args= 2>/dev/null || true)"
case "$CMD" in
    *python*server.py*|*python*server.py) ;;
    *)
        # The pid was recycled by something unrelated - leave it alone.
        echo "[INFO] Ignoring PID $DECK_PID (not a Config Deck process)."
        rm -f "$PID_FILE"
        exit 0
        ;;
esac

echo "[INFO] Stopping previous Config Deck (PID $DECK_PID)..."
kill "$DECK_PID" 2>/dev/null || true

# Give it a moment to release the listening socket, then escalate if needed.
for _ in $(seq 1 20); do
    kill -0 "$DECK_PID" 2>/dev/null || break
    sleep 0.1
done
if kill -0 "$DECK_PID" 2>/dev/null; then
    kill -9 "$DECK_PID" 2>/dev/null || true
fi

rm -f "$PID_FILE"
echo "[OK] Previous Config Deck stopped."
