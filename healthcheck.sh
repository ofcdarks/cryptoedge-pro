#!/bin/sh
# Healthcheck script for Docker
curl -f http://localhost:${PORT:-3000}/api/health > /dev/null 2>&1
