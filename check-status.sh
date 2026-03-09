#!/bin/bash

echo "🔍 燕云百业战管理工具 - 服务状态检查"
echo "=========================================="
echo ""

# 检查本地服务器
echo "📡 本地服务器状态："
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "✅ 本地服务器运行正常"
    echo "   访问地址: http://localhost:3000"
else
    echo "❌ 本地服务器未运行"
fi

echo ""

# 检查进程
echo "🔧 运行中的进程："
NODE_PID=$(ps aux | grep "node server.js" | grep -v grep | awk '{print $2}')
LT_PID=$(ps aux | grep "lt --port 3000" | grep -v grep | awk '{print $2}')

if [ -n "$NODE_PID" ]; then
    echo "✅ Node服务器 (PID: $NODE_PID)"
else
    echo "❌ Node服务器未运行"
fi

if [ -n "$LT_PID" ]; then
    echo "✅ LocalTunnel隧道 (PID: $LT_PID)"
    echo "   公网地址: https://yanyun-baiye.loca.lt"
    echo "   ⚠️  首次访问需要点击 'Click to Continue'"
else
    echo "❌ LocalTunnel隧道未运行"
fi

echo ""
echo "=========================================="
echo "💡 提示："
echo "   - 如需启动服务: ./start-public.sh"
echo "   - 如需停止服务: ./stop-service.sh"
