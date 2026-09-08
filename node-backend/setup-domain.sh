#!/usr/bin/env bash
# AGI-PM 域名部署脚本（服务器上跑）
# 用法：
#   1) 把本脚本和 nginx-agi-pm.conf 一起 rz 传到 ~/node-backend
#   2) chmod +x setup-domain.sh && ./setup-domain.sh
#   3) 脚本跑完确认 http 可访问后，按末尾提示再跑 certbot 上 HTTPS
set -e

DOMAIN=agi-goldsum-crm.duckdns.org
CONF_SRC="$(cd "$(dirname "$0")" && pwd)/nginx-agi-pm.conf"

echo "===== 1. 检查 DNS 是否解析到本机公网 IP ====="
PUB_IP=$(curl -s --max-time 8 https://api.ipify.org || curl -s --max-time 8 https://ifconfig.me || true)
echo "本机公网 IP : ${PUB_IP:-<获取失败>}"
RESOLVED=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1)
echo "$DOMAIN 解析到 : ${RESOLVED:-<无解析>}"
if [ -n "$RESOLVED" ] && [ "$RESOLVED" != "$PUB_IP" ]; then
  echo "⚠ 解析 IP 与本机公网 IP 不一致，certbot 会失败。"
  echo "  请去 DuckDNS 把 $DOMAIN 的 A 记录 IP 改成 $PUB_IP，等生效后再继续。"
elif [ -z "$RESOLVED" ]; then
  echo "⚠ $DOMAIN 暂未解析到任何 IP，请先去 DuckDNS 配置并等待生效。"
fi

echo
echo "===== 2. 安装 nginx ====="
sudo apt-get update
sudo apt-get install -y nginx

echo
echo "===== 3. 部署站点配置 ====="
sudo ln -sf "$CONF_SRC" /etc/nginx/sites-enabled/agi-pm.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl enable nginx

echo
echo "===== 4. 确认后端 3000 在跑 ====="
if curl -s -o /dev/null --max-time 5 http://127.0.0.1:3000/ ; then
  echo "✓ 本机 3000 响应正常"
else
  echo "⚠ 本机 3000 无响应！请先启动后端："
  echo "    (cd ~/node-backend && node server.mjs &)"
fi

echo
echo "=========================================="
echo "✅ HTTP 部署完成。浏览器访问： http://$DOMAIN"
echo "（若打不开，检查腾讯云防火墙是否放了 TCP 80）"
echo
echo "下一步上 HTTPS（等 DNS 和 80 端口都 OK 后）："
echo "  sudo apt-get install -y certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email"
echo "完成后即可用 https://$DOMAIN 访问（证书 90 天自动续期）"
echo "=========================================="
