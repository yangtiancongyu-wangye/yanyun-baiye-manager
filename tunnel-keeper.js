#!/usr/bin/env node

const { spawn } = require('child_process');

const SUBDOMAIN = 'yanyun-baiye';
const PORT = 3000;
const RESTART_DELAY = 5000; // 5秒后重启

let tunnelProcess = null;
let isShuttingDown = false;

function startTunnel() {
    if (isShuttingDown) return;

    console.log(`[${new Date().toLocaleTimeString()}] 启动 localtunnel...`);

    tunnelProcess = spawn('lt', ['--port', PORT, '--subdomain', SUBDOMAIN, '--print-requests'], {
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
    console.log('\n[${new Date().toLocaleTimeString()}] 收到退出信号，正在关闭...');
    isShuttingDown = true;
    if (tunnelProcess) {
        tunnelProcess.kill();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[${new Date().toLocaleTimeString()}] 收到终止信号，正在关闭...');
    isShuttingDown = true;
    if (tunnelProcess) {
        tunnelProcess.kill();
    }
    process.exit(0);
});

console.log('='.repeat(50));
console.log('Tunnel 守护进程已启动');
console.log(`固定域名: https://${SUBDOMAIN}.loca.lt`);
console.log(`本地端口: ${PORT}`);
console.log('按 Ctrl+C 退出');
console.log('='.repeat(50));

startTunnel();
