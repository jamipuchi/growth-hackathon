#!/bin/sh
# Frame-strip capture with the cached Chrome for Testing. Usage: dev/anim/run.sh [scenario,ids|all]
cd "$(dirname "$0")/../.."
PW_EXE="$HOME/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" node dev/anim/capture.mjs "$@"
