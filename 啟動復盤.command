#!/bin/zsh
# 從此專案啟動本機復盤頁。
cd "$(dirname "$0")" || exit 1
if [ ! -d node_modules ]; then npm ci || exit 1; fi
if [ ! -d .next ]; then npm run build || exit 1; fi
npm start
