#!/bin/bash
# 重启 node-backend 服务（用具体 PID，不用 pkill 宽泛模式）
PID=$(pgrep -f '/home/ubuntu/node-backend/server.mjs' | head -1)
if [ -n "$PID" ]; then
  echo "killing old pid $PID"
  sudo kill "$PID"
  sleep 1
else
  echo "no running server.mjs found"
fi
cd /home/ubuntu/node-backend
setsid sudo nohup /usr/bin/node /home/ubuntu/node-backend/server.mjs > /home/ubuntu/node-backend/server.out.log 2>&1 < /dev/null &
sleep 2
echo "--- new process ---"
ps aux | grep server.mjs | grep -v grep
echo "--- http check ---"
curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3000/
