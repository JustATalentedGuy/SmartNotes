#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
echo ""
echo " ================================================"
echo "   Smart Notes Generator v2 — Starting up..."
echo " ================================================"
echo ""

# ── Backend ───────────────────────────────────────────────────────────────
echo " [1/2] Installing backend dependencies..."
cd "$ROOT/backend"
pip3 install -r requirements.txt --quiet --upgrade

echo " Starting FastAPI backend on http://127.0.0.1:8000"
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!

# ── Frontend ──────────────────────────────────────────────────────────────
echo " [2/2] Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install --silent

echo " Starting React frontend on http://localhost:5173"
echo ""
echo " ✅ Opening http://localhost:5173 in your browser..."
echo " Press Ctrl+C to stop both servers."
echo ""

# Open browser after 3s
(sleep 3 && open http://localhost:5173 2>/dev/null || xdg-open http://localhost:5173 2>/dev/null || true) &

npm run dev

# Cleanup
kill $BACKEND_PID 2>/dev/null || true
