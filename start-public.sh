#!/bin/bash

# 燕云百业战管理工具 - 公网部署脚本
# 使用 localtunnel 提供固定的公网URL

echo "🚀 启动燕云百业战管理工具..."

# 检查是否安装了 localtunnel
if ! command -v lt &> /dev/null; then
    echo "📦 正在安装 localtunnel..."
    npm install -g localtunnel
fi

# 启动服务器（后台运行）
echo "🔧 启动本地服务器..."
node server.js &
SERVER_PID=$!

# 等待服务器启动
sleep 3

# 使用固定的子域名启动公网隧道
SUBDOMAIN="yanyun-baiye"
echo "🌐 建立公网隧道（固定URL）..."
echo "📍 公网访问地址: https://${SUBDOMAIN}.loca.lt"
echo ""
echo "⚠️  首次访问时，点击页面上的 'Click to Continue' 按钮即可"
echo "💡 按 Ctrl+C 停止服务"
echo ""

lt --port 3000 --subdomain ${SUBDOMAIN}

# 清理：停止服务器
kill $SERVER_PID
