#!/usr/bin/env bash
# ============================================================
# AGI-PM 腾讯云轻量（Ubuntu 22.04 / 香港 2C4G）一键部署
# 在 node-backend 目录内运行： sudo bash install.sh
# 前置：代码已传到服务器（git clone 或 scp -r 整个仓库到 /opt/agi-pm）
# ============================================================
set -e

echo "==> [1/5] 检查/安装 Node 20"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | tr -d v | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get update -y
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> [2/5] 安装 npm 依赖（better-sqlite3 有预编译二进制，无需本地编译）"
npm install

echo "==> [3/5] 生成 .env（已存在则跳过）"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    可编辑 .env 修改 VAULT_PIN / PORT / LOGIN_ONLY_USERS 等"
fi

echo "==> [4/5] 用 pm2 守护进程"
npm i -g pm2 >/dev/null 2>&1 || true
pm2 start server.mjs --name agi-pm
pm2 save

echo "==> [5/5] 完成"
echo "    访问： http://<本机公网IP>:3000"
echo "    验证： curl http://127.0.0.1:3000/api/health"
echo ""
echo "!! 重要：到腾讯云控制台 → 轻量应用服务器 → 防火墙 → 放通 TCP 3000（入站）"
echo "!! 想用域名+HTTPS：见 nginx-agi-pm.conf + certbot（脚本外另行配置）"
