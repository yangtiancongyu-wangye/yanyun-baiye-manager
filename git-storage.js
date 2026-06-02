// GitHub 数据持久化模块
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DATA_FILES = ['data/players.json', 'data/teams.json', 'data/lotteries.json'];
const DEFAULT_REPOSITORY = 'yangtiancongyu-wangye/yanyun-baiye-manager';

function getRepositoryConfig() {
    let repository = process.env.GITHUB_REPOSITORY || process.env.GH_REPOSITORY || '';
    if (!repository) {
        try {
            const remote = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
            const match = remote.match(/github\.com[:/](.+?)(?:\.git)?$/);
            if (match) repository = match[1];
        } catch (e) {}
    }

    return {
        repository: repository || DEFAULT_REPOSITORY,
        branch: process.env.GITHUB_BRANCH || 'main',
        token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
    };
}

function getGitHubHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'yanyun-baiye-manager'
    };
}

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
    const config = getRepositoryConfig();
    if (config.token) {
        return commitDataWithGitHubApi(message, config);
    }

    console.warn('未配置 GITHUB_TOKEN，回退到 git push 同步；线上环境可能因为没有 Git 凭据而失败');
    return commitDataWithGitCli(message);
}

async function commitDataWithGitHubApi(message, config) {
    try {
        const changedFiles = [];

        for (const file of DATA_FILES) {
            if (!fs.existsSync(file)) continue;

            const localContent = fs.readFileSync(file, 'utf8');
            const remote = await getRemoteFile(file, config);
            const remoteContent = remote?.content || '';

            if (normalizeJson(localContent) === normalizeJson(remoteContent)) {
                continue;
            }

            changedFiles.push({ file, content: localContent, sha: remote?.sha || null });
        }

        if (changedFiles.length === 0) {
            console.log('数据无变化，跳过提交');
            return { success: true, message: '无需提交' };
        }

        const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        for (const item of changedFiles) {
            await putRemoteFile(item.file, item.content, item.sha, `${message} - ${timestamp}`, config);
        }

        console.log(`✓ 数据已通过 GitHub API 保存: ${changedFiles.map(item => item.file).join(', ')}`);
        return { success: true, message: '数据已保存' };
    } catch (error) {
        const detail = error.response?.data?.message || error.message;
        console.error('GitHub API 自动保存失败:', detail);
        return { success: false, error: detail };
    }
}

async function getRemoteFile(file, config) {
    const url = `https://api.github.com/repos/${config.repository}/contents/${encodeURIComponentPath(file)}`;
    try {
        const response = await axios.get(url, {
            headers: getGitHubHeaders(config.token),
            params: { ref: config.branch },
            timeout: 15000
        });
        return {
            sha: response.data.sha,
            content: Buffer.from(response.data.content || '', 'base64').toString('utf8')
        };
    } catch (error) {
        if (error.response?.status === 404) return null;
        throw error;
    }
}

async function putRemoteFile(file, content, sha, message, config) {
    const url = `https://api.github.com/repos/${config.repository}/contents/${encodeURIComponentPath(file)}`;
    const body = {
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch: config.branch
    };
    if (sha) body.sha = sha;

    await axios.put(url, body, {
        headers: getGitHubHeaders(config.token),
        timeout: 20000
    });
}

function normalizeJson(content) {
    try {
        return JSON.stringify(JSON.parse(content));
    } catch (e) {
        return content.trim();
    }
}

function encodeURIComponentPath(file) {
    return file.split('/').map(part => encodeURIComponent(part)).join('/');
}

async function commitDataWithGitCli(message = '自动保存数据') {
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
    const config = getRepositoryConfig();
    if (config.token) {
        return pullDataWithGitHubApi(config);
    }

    console.warn('未配置 GITHUB_TOKEN，启动时回退到 git pull 加载数据');
    return pullDataWithGitCli();
}

async function pullDataWithGitHubApi(config) {
    try {
        const localDataStatus = getLocalDataStatus();
        if (localDataStatus.trim()) {
            console.warn('检测到本地数据尚未提交，跳过启动拉取，避免覆盖运行中数据');
            debouncedCommit('保存启动前本地数据', 0);
            return { success: true, skipped: true };
        }

        for (const file of DATA_FILES) {
            const remote = await getRemoteFile(file, config);
            if (!remote) continue;
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, remote.content);
        }

        console.log('✓ 已通过 GitHub API 加载最新数据');
        return { success: true };
    } catch (error) {
        const detail = error.response?.data?.message || error.message;
        console.error('GitHub API 拉取数据失败:', detail);
        return { success: false, error: detail };
    }
}

function getLocalDataStatus() {
    try {
        return execSync('git status --porcelain data/', { encoding: 'utf8' });
    } catch (e) {
        return '';
    }
}

async function pullDataWithGitCli() {
    try {
        ensureGitConfig();

        const localDataStatus = getLocalDataStatus();
        if (localDataStatus.trim()) {
            console.warn('检测到本地数据尚未提交，跳过启动拉取，避免覆盖运行中数据');
            debouncedCommit('保存启动前本地数据', 0);
            return { success: true, skipped: true };
        }

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
let pendingMessage = null;
let retryTimer = null;
let retryAttempts = 0;
let syncStatus = {
    pending: false,
    retryAttempts: 0,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    lastMessage: null
};

function debouncedCommit(message, delay = 1000) {
    pendingMessage = message;
    syncStatus.pending = true;
    syncStatus.lastMessage = message;
    if (commitTimer) {
        clearTimeout(commitTimer);
    }
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }

    commitTimer = setTimeout(() => {
        commitTimer = null;
        runReliableCommit(message);
    }, delay);
}

async function runReliableCommit(message) {
    const result = await commitData(message);
    if (result.success) {
        pendingMessage = null;
        retryAttempts = 0;
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
        syncStatus.pending = false;
        syncStatus.retryAttempts = 0;
        syncStatus.lastSuccessAt = new Date().toISOString();
        syncStatus.lastErrorAt = null;
        syncStatus.lastError = null;
        return;
    }

    retryAttempts++;
    syncStatus.pending = true;
    syncStatus.retryAttempts = retryAttempts;
    syncStatus.lastErrorAt = new Date().toISOString();
    syncStatus.lastError = result.error || '未知同步失败';
    const retryDelay = Math.min(60000, 5000 * retryAttempts);
    console.warn(`数据保存到 GitHub 失败，${Math.round(retryDelay / 1000)} 秒后重试第 ${retryAttempts} 次`);
    retryTimer = setTimeout(() => {
        runReliableCommit(pendingMessage || message);
    }, retryDelay);
}

function getSyncStatus() {
    const config = getRepositoryConfig();
    return {
        ...syncStatus,
        storageMode: config.token ? 'github-api' : 'git-cli',
        repository: config.repository,
        branch: config.branch,
        hasScheduledCommit: Boolean(commitTimer),
        hasScheduledRetry: Boolean(retryTimer)
    };
}

// 进程退出前立即执行挂起的提交，防止重新部署时数据丢失
function flushPendingCommit() {
    if ((commitTimer || retryTimer) && pendingMessage) {
        if (commitTimer) clearTimeout(commitTimer);
        if (retryTimer) clearTimeout(retryTimer);
        commitTimer = null;
        retryTimer = null;
        console.log('进程退出，立即提交挂起的数据...');
        // 同步方式提交，确保在进程退出前完成
        try {
            ensureGitConfig();
            const status = execSync('git status --porcelain data/', { encoding: 'utf8' });
            if (status.trim()) {
                execSync('git add data/players.json data/teams.json data/lotteries.json');
                const timestamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                execSync(`git commit -m "${pendingMessage} - ${timestamp}"`);
                try { execSync('git pull --rebase origin main', { timeout: 10000 }); } catch (e) {}
                execSync('git push origin main', { timeout: 15000 });
                console.log('✓ 退出前数据已保存到 GitHub');
            }
        } catch (e) {
            console.error('退出前提交失败:', e.message);
        }
        pendingMessage = null;
    }
}

process.on('SIGTERM', () => { flushPendingCommit(); process.exit(0); });
process.on('SIGINT', () => { flushPendingCommit(); process.exit(0); });

module.exports = {
    commitData,
    pullData,
    debouncedCommit,
    getSyncStatus
};
