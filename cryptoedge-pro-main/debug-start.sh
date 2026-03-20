#!/bin/sh
echo "=== Environment ==="
echo "NODE_ENV=$NODE_ENV"
echo "PORT=$PORT"
echo "DB_PATH=$DB_PATH"
echo "Node version: $(node --version)"
echo "=== Checking /data ==="
ls -la /data/ 2>/dev/null || echo "/data not found"
echo "=== Starting server ==="
node server.js
