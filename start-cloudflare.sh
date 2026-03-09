#!/bin/bash

# 燕云百业战管理工具 - Cloudflare Tunnel 部署脚本
# 提供最稳定的公网访问方案

echo "🚀 启动燕云百业战管理工具（Cloudflare Tunnel）..."

# 检查是否安装了 cloudflared
if ! command -v cloudflared &> /dev/null; then
    echo "📦 正在安装 cloudflared..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        brew install cloudflare/cloudflare/cloudflared
    else
        # Linux
        wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
        sudo dpkg -i cloudflared-linux-amd64.deb
    fi
fi

# 启动服务器（后台运行）
echo "🔧 启动本地服务器..."
node server.js &
SERVER_PID=$!

# 等待服务器启动
sleep 3

echo "🌐 建立 Cloudflare 隧道..."
echo "📍 公网URL将在下方显示"
echo "💡 按 Ctrl+C 停止服务"
echo ""

# 启动 cloudflared 隧道
cloudflared tunnel --url http://localhost:3000

# 清理：停止服务器
kill $SERVER_PID
