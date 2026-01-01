#!/bin/bash
set -e

# Fix rollup optional dependency issue if needed
if [ "$1" = "--clean" ] || [ ! -d "node_modules/.pnpm/@rollup+rollup-darwin-arm64" ]; then
  echo "🧹 Cleaning node_modules..."
  rm -rf node_modules packages/*/node_modules
  echo "📦 Installing dependencies..."
  pnpm install
fi

echo "🔨 Building packages..."
pnpm build

echo "🐳 Rebuilding and restarting Docker..."
docker-compose down
docker-compose up --build -d

echo "✅ Done! Server running in background."
echo ""
echo "Don't forget to reload the extension in Chrome:"
echo "  chrome://extensions → Claude Blocker → 🔄"
