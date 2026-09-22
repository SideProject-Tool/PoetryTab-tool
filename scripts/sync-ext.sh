#!/bin/bash
# 构建扩展并同步到本地 Chrome「加载已解压的扩展程序」目录
# 用法：npm run ext:sync   （或 bash scripts/sync-ext.sh）
# 目标目录可用环境变量覆盖：EXT_DIR=D:/somewhere npm run ext:sync
set -e
cd "$(dirname "$0")/.."
DEST="${EXT_DIR:-C:/Users/chenp/Tools/Poetry-Tab}"

npm run build
rm -rf "$DEST"
cp -r .output/chrome-mv3 "$DEST"
echo "✓ 已同步扩展构建产物到 $DEST（记得在 chrome://extensions 里重新加载）"
