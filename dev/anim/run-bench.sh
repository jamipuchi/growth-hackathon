#!/bin/sh
cd "$(dirname "$0")/../.."
PW_EXE="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" node dev/anim/bench.mjs
