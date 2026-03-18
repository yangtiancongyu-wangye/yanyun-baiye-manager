// GitHub 数据持久化模块
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 配置 Git 用户信息（如果未配置）
function ensureGitConfig() {
    try {
        execSync('git config user.email', { stdio: 'pipe' });
    } catch (e) {
        execSync('git config user.email "yanyun-manager@example.com"');
        execSync('git config user.name "Yanyun Manager"');
    }
}

// 提交数据到 GitHub
async function commitData(message = '自动保存数据') {
    try {
        ensureGitConfig();

        // 检查是否有变化
        const status = execSync('git status --porcelain data/', { encoding: 'utf8' });
        if (!status.trim()) {
            console.log('数据无变化，跳过提交');
            return { success: true, message: '无需提交' };
        }

        // 添加数据文件
        execSync('git add data/players.json data/teams.json data/lotteries.json');

        // 提交
        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        execSync(`git commit -m "${message} - ${timestamp}"`);

        // 先 pull rebase 再推送，避免代码更新导致冲突
        try {
            execSync('git pull --rebase origin main', { timeout: 15000 });
        } catch (pullErr) {
            console.warn('pull rebase 失败，尝试直接推送:', pullErr.message);
        }

        // 推送到 GitHub
        execSync('git push origin main', { timeout: 15000 });

        console.log('✓ 数据已自动保存到 GitHub');
        return { success: true, message: '数据已保存' };
    } catch (error) {
        console.error('自动保存失败:', error.message);
        return { success: false, error: error.message };
    }
}

// 从 GitHub 拉取最新数据
async function pullData() {
    try {
        ensureGitConfig();

        // 拉取最新数据
        execSync('git pull origin main', { timeout: 10000 });

        console.log('✓ 已从 GitHub 加载最新数据');
        return { success: true };
    } catch (error) {
        console.error('拉取数据失败:', error.message);
        return { success: false, error: error.message };
    }
}

// 防抖函数 - 避免频繁提交
let commitTimer = null;
function debouncedCommit(message, delay = 5000) {
    if (commitTimer) {
        clearTimeout(commitTimer);
    }

    commitTimer = setTimeout(() => {
        commitData(message);
    }, delay);
}

module.exports = {
    commitData,
    pullData,
    debouncedCommit
};
