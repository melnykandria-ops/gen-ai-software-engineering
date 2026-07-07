#!/usr/bin/env bash
#
# Start the Intelligent Customer Support System API.
# Usage: ./demo/run.sh   (from the homework-2 directory)
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

echo "🎧 Starting Intelligent Customer Support System on http://localhost:${PORT:-3000}"
npm start
