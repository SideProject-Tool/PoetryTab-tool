#!/bin/bash
# 网页版构建 + 部署到 Cloudflare Worker（sync.pathmemos.com）
set -e
cd "$(dirname "$0")"

# 1) 构建共享 React 应用（网页目标）
pnpm exec vite build --config vite.web.config.mjs

# 2) 入口 HTML 归位到产物根目录
if [ -f dist-web/web/index.html ]; then
  mv dist-web/web/index.html dist-web/index.html
  rm -rf dist-web/web
fi

# 3) 同步到控制机上的 Worker 项目目录（worker.js 以本仓库为准；wrangler.toml 沿用服务器上的）
SERVER=root@192.168.1.44
DEST=/root/proton-collect-worker

ssh $SERVER "rm -rf $DEST/public && mkdir -p $DEST/public"
scp -r dist-web/. $SERVER:$DEST/public/
scp worker/src/worker.js $SERVER:$DEST/src/worker.js

# 4) 服务器端部署（凭据在 /root/.secrets.env）
ssh $SERVER "bash -lc 'export PATH=/root/AgentTool/bin:\$PATH; source /root/.secrets.env 2>/dev/null; cd $DEST && wrangler deploy' 2>&1 | tail -3"

echo "网页版部署完成：https://sync.pathmemos.com"
