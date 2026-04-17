#!/usr/bin/env node

// 使用 cloudflared 替代 localtunnel
// 原因：localtunnel 对 POST 请求有约 1-2 秒超时限制，GLM-OCR 识别需要 10-30 秒，导致请求被截断
// cloudflared 无此限制，更适合有耗时 API 调用的场景

const { spawn } = require('child_process');

const PORT = 3000;
const RESTART_DELAY = 5000; // 5秒后重启

let tunnelProcess = null;
let isShuttingDown = false;

function startTunnel() {
    if (isShuttingDown) return;

    console.log(`[${new Date().toLocaleTimeString()}] 启动 cloudflared tunnel...`);

    tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
        stdio: 'inherit'
    });

    tunnelProcess.on('exit', (code, signal) => {
        if (isShuttingDown) {
            console.log(`[${new Date().toLocaleTimeString()}] Tunnel 已停止`);
            return;
        }

        console.log(`[${new Date().toLocaleTimeString()}] Tunnel 意外退出 (code: ${code}, signal: ${signal})`);
        console.log(`[${new Date().toLocaleTimeString()}] ${RESTART_DELAY/1000}秒后自动重启...`);

        setTimeout(() => {
            startTunnel();
        }, RESTART_DELAY);
    });

    tunnelProcess.on('error', (err) => {
        console.error(`[${new Date().toLocaleTimeString()}] Tunnel 错误:`, err.message);
    });
}

// 优雅退出
process.on('SIGINT', () => {
    console.log('\n收到退出信号，正在关闭...');
    isShuttingDown = true;
    if (tunnelProcess) {
        tunnelProcess.kill();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n收到终止信号，正在关闭...');
    isShuttingDown = true;
    if (tunnelProcess) {
        tunnelProcess.kill();
    }
    process.exit(0);
});

console.log('='.repeat(50));
console.log('Cloudflare Tunnel 守护进程已启动');
console.log(`本地端口: ${PORT}`);
console.log('公网URL将在启动后输出（每次随机）');
console.log('按 Ctrl+C 退出');
console.log('='.repeat(50));

startTunnel();
