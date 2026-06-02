// 数据存储
let players = [];
let teams = {};
let lotteries = [];
let currentBattleDate = new Date().toISOString().split('T')[0];
let syncWarningTimer = null;

// DOM元素
const navBtns = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');
const playerModal = document.getElementById('player-modal');
const playerForm = document.getElementById('player-form');
const addPlayerBtn = document.getElementById('add-player-btn');
const importPlayersBtn = document.getElementById('import-players-btn');
const importRegistrationBtn = document.getElementById('import-registration-btn');
const battleDateSelect = document.getElementById('battle-date-select');
const smartAssignBtn = document.getElementById('smart-assign-btn');
const exportTeamBtn = document.getElementById('export-team-btn');
const createNewDateBtn = document.getElementById('create-new-date-btn');

// 从服务器加载数据
async function loadDataFromServer() {
    try {
        const [playersRes, teamsRes, lotteriesRes] = await Promise.all([
            fetch('/api/players'),
            fetch('/api/teams'),
            fetch('/api/lotteries')
        ]);
        players = await playersRes.json();
        teams = await teamsRes.json();
        lotteries = await lotteriesRes.json();
    } catch (error) {
        console.error('加载数据失败:', error);
    }
}

function scheduleSyncStatusCheck() {
    if (syncWarningTimer) {
        clearTimeout(syncWarningTimer);
    }
    syncWarningTimer = setTimeout(async () => {
        try {
            const response = await fetch('/api/sync-status');
            const status = await response.json();
            if (status.lastError && status.pending) {
                alert(`数据已暂存到当前服务，但远端同步失败，刷新或部署可能丢失：${status.lastError}`);
            }
        } catch (error) {
            console.error('检查数据同步状态失败:', error);
        }
    }, 4000);
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await loadDataFromServer();
    syncLotteryPlayersWithTalent();
    renderTalentTable();
    updateBatchSelect();
    renderLotteryTable();
    setupEventListeners();
});

// 页面切换
navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const targetPage = btn.dataset.page;
        navBtns.forEach(b => b.classList.remove('active'));
        pages.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`${targetPage}-page`).classList.add('active');
    });
});

// 事件监听
function setupEventListeners() {
    addPlayerBtn.addEventListener('click', () => openPlayerModal());
    importPlayersBtn.addEventListener('change', handleImportPlayers);
    document.getElementById('import-registration-btn').addEventListener('click', showImportRegistrationModal);
    document.getElementById('import-registration-file').addEventListener('change', handleImportRegistrationFile);
    document.getElementById('add-registration-btn').addEventListener('click', showAddRegistrationModal);
    battleDateSelect.addEventListener('change', (e) => {
        currentBattleDate = e.target.value;
        loadTeamData(currentBattleDate);
    });
    smartAssignBtn.addEventListener('click', handleSmartAssign);
    exportTeamBtn.addEventListener('click', handleExportTeam);
    createNewDateBtn.addEventListener('click', showNewBatchModal);

    document.querySelector('.close').addEventListener('click', closePlayerModal);
    document.getElementById('cancel-btn').addEventListener('click', closePlayerModal);
    playerForm.addEventListener('submit', handlePlayerSubmit);

    // 粘贴事件监听
    setupPasteListener();

    setupDragAndDrop();

    // 抽奖功能事件监听
    setupLotteryEventListeners();
}

// 人才库相关
function renderTalentTable() {
    const tbody = document.getElementById('talent-tbody');
    tbody.innerHTML = '';

    players.forEach((player, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${player.id}</td>
            <td>${(player.professions || []).join(', ')}</td>
            <td>${player.notes || '-'}</td>
            <td>
                <button class="btn btn-secondary" onclick="editPlayer(${index})">编辑</button>
                <button class="btn btn-danger" onclick="deletePlayer(${index})">删除</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openPlayerModal(playerIndex = null) {
    playerModal.classList.add('active');
    document.getElementById('modal-title').textContent = playerIndex !== null ? '编辑玩家' : '添加玩家';

    if (playerIndex !== null) {
        const player = players[playerIndex];
        document.getElementById('player-id').value = player.id;
        document.getElementById('player-notes').value = player.notes || '';

        const select = document.getElementById('player-professions');
        select.value = (player.professions && player.professions[0]) || '';

        playerForm.dataset.editIndex = playerIndex;
    } else {
        playerForm.reset();
        delete playerForm.dataset.editIndex;
    }
}

function closePlayerModal() {
    playerModal.classList.remove('active');
    playerForm.reset();
}

async function handlePlayerSubmit(e) {
    e.preventDefault();

    const id = document.getElementById('player-id').value.trim();
    const select = document.getElementById('player-professions');
    const profession = select.value;
    const notes = document.getElementById('player-notes').value.trim();

    if (!profession) {
        alert('请选择流派');
        return;
    }

    const player = { id, professions: [profession], notes };
    let lotteriesChanged = false;

    if (playerForm.dataset.editIndex !== undefined) {
        // 编辑时保留原有uid
        const existing = players[parseInt(playerForm.dataset.editIndex)];
        if (existing.uid) player.uid = existing.uid;
        const oldId = existing.id;
        players[parseInt(playerForm.dataset.editIndex)] = player;
        // 同步到配队数据
        syncPlayerToTeams(oldId, player);
        // 同步到报名数据（id变更时）
        if (oldId !== player.id) {
            syncPlayerIdToLotteries(oldId, player.id, false);
            lotteriesChanged = true;
        }
    } else {
        // 新增时生成uid（服务端会兜底，前端也生成以确保本地一致性）
        player.uid = 'u' + Math.random().toString(36).substring(2, 11);
        players.push(player);
        lotteriesChanged = syncLotteryPlayersWithTalent(false);
    }

    const playersSaved = await savePlayers();
    if (playersSaved && lotteriesChanged) {
        await saveLotteries();
        renderLotteryTable();
    }
    renderTalentTable();
    closePlayerModal();
}

function editPlayer(index) {
    openPlayerModal(index);
}

// 同步玩家变更到所有配队数据
function syncPlayerToTeams(oldId, newPlayer) {
    let changed = false;
    Object.keys(teams).forEach(date => {
        ['attack', 'defense'].forEach(side => {
            (teams[date][side] || []).forEach(squad => {
                (squad || []).forEach(member => {
                    if (member && member.id === oldId) {
                        member.id = newPlayer.id;
                        member.professions = newPlayer.professions.slice();
                        changed = true;
                    }
                });
            });
        });
    });
    if (changed) {
        saveTeams();
        if (document.querySelector('[data-page="team"]').classList.contains('active')) {
            renderTeams(currentBattleDate);
        }
    }
}

// 同步玩家ID变更到报名数据
function syncPlayerIdToLotteries(oldId, newId, saveAfterSync = true) {
    let changed = false;
    lotteries.forEach(lottery => {
        if (lottery.playerIds) {
            lottery.playerIds = lottery.playerIds.map(id => {
                if (id === oldId) {
                    changed = true;
                    return newId;
                }
                return id;
            });
        }
        if (lottery.winners) {
            lottery.winners = lottery.winners.map(id => {
                if (id === oldId) {
                    changed = true;
                    return newId;
                }
                return id;
            });
        }
        if (lottery.excludedPlayerIds) {
            lottery.excludedPlayerIds = lottery.excludedPlayerIds.map(id => {
                if (id === oldId) {
                    changed = true;
                    return newId;
                }
                return id;
            });
        }
    });
    const poolChanged = syncLotteryPlayersWithTalent(false);
    if ((changed || poolChanged) && saveAfterSync) {
        saveLotteries();
        renderLotteryTable();
    }
    return changed || poolChanged;
}

function getTalentPlayerIds() {
    return players.map(player => player.id);
}

function isLotteryDrawn(lottery) {
    return Array.isArray(lottery.winners) && lottery.winners.length > 0;
}

function normalizePendingLotteryPool(lottery, playerIds = getTalentPlayerIds()) {
    const excludedIds = new Set(Array.isArray(lottery.excludedPlayerIds) ? lottery.excludedPlayerIds : []);
    return playerIds.filter(id => !excludedIds.has(id));
}

function getLotteryExcludedPlayerIds(selectedIds) {
    const selected = new Set(selectedIds);
    return getTalentPlayerIds().filter(id => !selected.has(id));
}

// 未开奖抽奖池跟随人才库，并保留单个抽奖手动剔除的玩家。
function syncLotteryPlayersWithTalent(saveAfterSync = true) {
    const playerIds = getTalentPlayerIds();
    let changed = false;

    lotteries.forEach(lottery => {
        if (isLotteryDrawn(lottery)) return;

        const currentIds = Array.isArray(lottery.playerIds) ? lottery.playerIds : [];
        const nextIds = normalizePendingLotteryPool(lottery, playerIds);
        const nextExcludedIds = Array.isArray(lottery.excludedPlayerIds)
            ? lottery.excludedPlayerIds.filter(id => playerIds.includes(id))
            : [];
        const isSamePool = currentIds.length === nextIds.length &&
            currentIds.every((id, index) => id === nextIds[index]);
        const isSameExcluded = Array.isArray(lottery.excludedPlayerIds) &&
            lottery.excludedPlayerIds.length === nextExcludedIds.length &&
            lottery.excludedPlayerIds.every((id, index) => id === nextExcludedIds[index]);

        if (!isSamePool || !isSameExcluded) {
            lottery.playerIds = nextIds;
            lottery.excludedPlayerIds = nextExcludedIds;
            changed = true;
        }
    });

    if (changed && saveAfterSync) {
        saveLotteries();
        renderLotteryTable();
    }

    return changed;
}

async function deletePlayer(index) {
    if (confirm('确定删除该玩家吗？')) {
        const deletedPlayer = players[index];
        players.splice(index, 1);
        let lotteriesChanged = false;
        if (deletedPlayer) {
            lotteriesChanged = syncLotteryPlayersWithTalent(false);
        }
        const playersSaved = await savePlayers();
        if (playersSaved && lotteriesChanged) {
            await saveLotteries();
            renderLotteryTable();
        }
        renderTalentTable();
    }
}

async function savePlayers() {
    try {
        const response = await fetch('/api/players', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(players)
        });
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || '保存失败');
        }
        scheduleSyncStatusCheck();
        return true;
    } catch (error) {
        console.error('保存玩家数据失败:', error);
        alert('保存玩家数据失败：' + error.message);
        return false;
    }
}

// OCR导入玩家
async function handleImportPlayers(e) {
    const file = e.target.files[0];
    if (!file) return;

    showLoading('正在识别图片...');

    try {
        // 将图片转换为base64
        const imageBase64 = await fileToBase64(file);

        // 调用后端API
        const response = await fetch('/api/ocr-players', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64 })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        let imported = 0;

        for (const playerData of result.players) {
            const existingPlayer = players.find(p => p.id === playerData.id);
            if (!existingPlayer) {
                players.push({
                    id: playerData.id,
                    professions: playerData.professions.slice(0, 2),
                    notes: ''
                });
                imported++;
            }
        }

        const lotteriesChanged = syncLotteryPlayersWithTalent(false);
        const playersSaved = await savePlayers();
        if (playersSaved && lotteriesChanged) {
            await saveLotteries();
            renderLotteryTable();
        }
        renderTalentTable();
        hideLoading();
        alert(`成功导入 ${imported} 个新玩家`);
    } catch (error) {
        hideLoading();
        alert('识别失败：' + error.message);
    }

    e.target.value = '';
}

// 导入报名玩家
function showImportRegistrationModal() {
    document.getElementById('import-registration-modal').classList.add('active');
    document.getElementById('paste-area').innerHTML = '<span style="color: #999;">等待粘贴图片...</span>';
}

function closeImportRegistrationModal() {
    document.getElementById('import-registration-modal').classList.remove('active');
}

// 设置粘贴监听
function setupPasteListener() {
    const modal = document.getElementById('import-registration-modal');

    document.addEventListener('paste', async (e) => {
        // 只在弹窗打开时处理粘贴
        if (!modal.classList.contains('active')) return;

        const items = e.clipboardData.items;
        for (let item of items) {
            if (item.type.indexOf('image') !== -1) {
                e.preventDefault();
                const file = item.getAsFile();
                const pasteArea = document.getElementById('paste-area');

                // 显示预览
                const reader = new FileReader();
                reader.onload = (event) => {
                    pasteArea.innerHTML = `<img src="${event.target.result}" style="max-width: 100%; max-height: 200px; border-radius: 4px;">`;
                };
                reader.readAsDataURL(file);

                // 处理图片
                await processRegistrationImage(file);
                break;
            }
        }
    });
}

// 处理文件上传
async function handleImportRegistrationFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    await processRegistrationImage(file);
    e.target.value = '';
}

// 处理报名图片
// 压缩图片为 blob（用于上传，最大 1200px，质量 80%）
function compressImageToBlob(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxSize = 1200;
                if (width > maxSize || height > maxSize) {
                    if (width > height) {
                        height = Math.round((height / width) * maxSize);
                        width = maxSize;
                    } else {
                        width = Math.round((width / height) * maxSize);
                        height = maxSize;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function processRegistrationImage(file) {
    showLoading('正在识别报名玩家...');
    closeImportRegistrationModal();

    try {
        // 准备人才库玩家列表
        const playersList = players.map(p => p.id);

        // 压缩图片后再上传（避免大图超过隧道/网关限制）
        const compressedBlob = await compressImageToBlob(file);
        const formData = new FormData();
        formData.append('image', compressedBlob, 'image.jpg');
        formData.append('playersList', JSON.stringify(playersList));

        // 调用后端API
        const response = await fetch('/api/ocr-registration', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        const registeredPlayers = [];
        const notFoundIds = [];

        // 确保当前日期的队伍数据存在
        if (!teams[currentBattleDate]) {
            teams[currentBattleDate] = {
                attack: [[], [], []],
                defense: [[], [], []],
                availablePlayers: []
            };
        }

        for (const id of result.playerIds) {
            // 精确匹配
            let player = players.find(p => p.id === id);

            // 如果精确匹配失败，尝试模糊匹配
            if (!player) {
                player = players.find(p => p.id.includes(id) || id.includes(p.id));
            }

            if (player) {
                // 检查是否已经在可用玩家列表中
                const exists = teams[currentBattleDate].availablePlayers.some(p => p.id === player.id);
                if (!exists) {
                    registeredPlayers.push({...player});
                }
            } else {
                notFoundIds.push(id);
            }
        }

        teams[currentBattleDate].availablePlayers.push(...registeredPlayers);
        saveTeams();
        renderAvailablePlayers(teams[currentBattleDate].availablePlayers);
        hideLoading();

        let message = `新增 ${registeredPlayers.length} 个报名玩家`;
        if (notFoundIds.length > 0) {
            message += `\n\n未在人才库中找到以下玩家：\n${notFoundIds.join(', ')}`;
        }
        alert(message);
    } catch (error) {
        hideLoading();
        alert('识别失败：' + error.message);
    }
}

// 旧的导入报名玩家函数（已废弃）
async function handleImportRegistration(e) {
    const file = e.target.files[0];
    if (!file) return;

    showLoading('正在识别报名玩家...');

    try {
        // 将图片转换为base64
        const imageBase64 = await fileToBase64(file);

        // 调用后端API
        const response = await fetch('/api/ocr-registration', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64 })
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        const registeredPlayers = [];
        const notFoundIds = [];

        // 确保当前日期的队伍数据存在
        if (!teams[currentBattleDate]) {
            teams[currentBattleDate] = {
                attack: [[], [], []],
                defense: [[], [], []],
                availablePlayers: []
            };
        }

        for (const id of result.playerIds) {
            // 精确匹配
            let player = players.find(p => p.id === id);

            // 如果精确匹配失败，尝试模糊匹配
            if (!player) {
                player = players.find(p => p.id.includes(id) || id.includes(p.id));
            }

            if (player) {
                // 检查是否已经在可用玩家列表中
                const exists = teams[currentBattleDate].availablePlayers.some(p => p.id === player.id);
                if (!exists) {
                    registeredPlayers.push({...player});
                }
            } else {
                notFoundIds.push(id);
            }
        }

        teams[currentBattleDate].availablePlayers.push(...registeredPlayers);
        saveTeams();
        renderAvailablePlayers(teams[currentBattleDate].availablePlayers);
        hideLoading();

        let message = `新增 ${registeredPlayers.length} 个报名玩家`;
        if (notFoundIds.length > 0) {
            message += `\n\n未在人才库中找到以下玩家：\n${notFoundIds.join(', ')}`;
        }
        alert(message);
    } catch (error) {
        hideLoading();
        alert('识别失败：' + error.message);
    }

    e.target.value = '';
}

// 图片转base64并压缩
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const maxSize = 1024;

                if (width > maxSize || height > maxSize) {
                    if (width > height) {
                        height = (height / width) * maxSize;
                        width = maxSize;
                    } else {
                        width = (width / height) * maxSize;
                        height = maxSize;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 队伍管理相关
function loadTeamData(date) {
    if (!teams[date]) {
        teams[date] = {
            attack: [[], [], []],
            defense: [[], [], []],
            availablePlayers: []
        };
    }

    renderAvailablePlayers(teams[date].availablePlayers);
    renderTeams(date);
}

function renderAvailablePlayers(playerList = null) {
    const container = document.getElementById('available-players-list');
    container.innerHTML = '';

    const playersToRender = playerList || teams[currentBattleDate]?.availablePlayers || [];

    playersToRender.forEach((player, index) => {
        const card = createPlayerCard(player, 'available', index);
        container.appendChild(card);
    });

    // 更新统计信息
    updatePlayerStats();
}

function updatePlayerStats() {
    const statsEl = document.getElementById('player-stats');
    if (!statsEl) return;

    const teamData = teams[currentBattleDate];
    if (!teamData) {
        statsEl.textContent = '';
        return;
    }

    // 计算可用玩家数量
    const availableCount = teamData.availablePlayers.length;

    // 计算已配队玩家数量（不重复计算）
    const assignedPlayerIds = new Set();
    teamData.attack.forEach(squad => {
        squad.forEach(member => assignedPlayerIds.add(member.id));
    });
    teamData.defense.forEach(squad => {
        squad.forEach(member => assignedPlayerIds.add(member.id));
    });
    const assignedCount = assignedPlayerIds.size;

    statsEl.innerHTML = `当前可用玩家<span style="color: #ff0000;">${availableCount}</span>人，已配队玩家<span style="color: #ff0000;">${assignedCount}</span>人`;
}

function renderTeams(date) {
    const teamData = teams[date];
    if (!teamData) return;

    ['attack', 'defense'].forEach(brigade => {
        teamData[brigade].forEach((squad, squadIndex) => {
            const squadEl = document.querySelector(`.squad[data-brigade="${brigade}"][data-squad="${squadIndex + 1}"] .squad-members`);
            squadEl.innerHTML = '';

            squad.forEach((member, memberIndex) => {
                const memberEl = createSquadMember(member, brigade, squadIndex, memberIndex);
                squadEl.appendChild(memberEl);
            });

            // 添加空位占位符
            const emptySlots = 5 - squad.length;
            for (let i = 0; i < emptySlots; i++) {
                const emptyRow = document.createElement('tr');
                emptyRow.className = 'squad-member-empty';
                emptyRow.innerHTML = '<td colspan="4">待分配对应玩家</td>';
                squadEl.appendChild(emptyRow);
            }
        });
    });

    // 更新统计信息
    updatePlayerStats();
}

function createPlayerCard(player, source, index) {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.draggable = true;
    card.dataset.source = source;
    card.dataset.index = index;
    card.dataset.playerId = player.id;

    card.innerHTML = `
        <button class="player-card-delete" onclick="removeAvailablePlayer(${index})">&times;</button>
        <div class="player-card-id">${player.id}</div>
        <div class="player-card-professions">${(player.professions || []).join(', ')}</div>
    `;

    return card;
}

function createSquadMember(member, brigade, squadIndex, memberIndex) {
    const tr = document.createElement('tr');
    tr.className = 'squad-member';
    tr.draggable = true;
    tr.dataset.brigade = brigade;
    tr.dataset.squad = squadIndex;
    tr.dataset.member = memberIndex;

    tr.innerHTML = `
        <td class="member-id">
            <button class="remove-member-inline" onclick="removeMember('${brigade}', ${squadIndex}, ${memberIndex})">×</button>
            ${member.id}
        </td>
        <td class="member-professions">${(member.professions || []).join('、')}</td>
        <td class="member-plan"><textarea placeholder="开局安排" onchange="updateMemberPlan('${brigade}', ${squadIndex}, ${memberIndex}, 'startPlan', this.value)">${member.startPlan || ''}</textarea></td>
        <td class="member-plan"><textarea placeholder="后续安排" onchange="updateMemberPlan('${brigade}', ${squadIndex}, ${memberIndex}, 'followPlan', this.value)">${member.followPlan || ''}</textarea></td>
    `;

    return tr;
}

function removeMember(brigade, squadIndex, memberIndex) {
    const member = teams[currentBattleDate][brigade][squadIndex][memberIndex];
    teams[currentBattleDate][brigade][squadIndex].splice(memberIndex, 1);
    teams[currentBattleDate].availablePlayers.push(member);
    saveTeams();
    loadTeamData(currentBattleDate);
}

function removeAvailablePlayer(index) {
    teams[currentBattleDate].availablePlayers.splice(index, 1);
    saveTeams();
    loadTeamData(currentBattleDate);
}

function updateMemberPlan(brigade, squadIndex, memberIndex, field, value) {
    teams[currentBattleDate][brigade][squadIndex][memberIndex][field] = value;
    saveTeams();
}

async function saveTeams() {
    try {
        const response = await fetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(teams)
        });
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || '保存失败');
        }
        scheduleSyncStatusCheck();
        return true;
    } catch (error) {
        console.error('保存配队数据失败:', error);
        alert('保存配队数据失败：' + error.message);
        return false;
    }
}

// 拖拽功能
function setupDragAndDrop() {
    let draggedElement = null;

    document.addEventListener('dragstart', (e) => {
        if (e.target.classList.contains('player-card') || e.target.classList.contains('squad-member')) {
            draggedElement = e.target;
            e.target.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        }
    });

    document.addEventListener('dragend', (e) => {
        if (e.target.classList.contains('player-card') || e.target.classList.contains('squad-member')) {
            e.target.classList.remove('dragging');
            draggedElement = null;
        }
    });

    document.addEventListener('dragover', (e) => {
        const target = e.target.closest('.squad-members');
        if (target) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            target.classList.add('drag-over');
        }
    });

    document.addEventListener('dragleave', (e) => {
        const target = e.target.closest('.squad-members');
        if (target && !target.contains(e.relatedTarget)) {
            target.classList.remove('drag-over');
        }
    });

    document.addEventListener('drop', (e) => {
        const squad = e.target.closest('.squad-members');
        if (squad) {
            e.preventDefault();
            squad.classList.remove('drag-over');

            if (!draggedElement) return;

            const brigade = squad.closest('.squad').dataset.brigade;
            const squadIndex = parseInt(squad.closest('.squad').dataset.squad) - 1;

            let player;
            if (draggedElement.classList.contains('player-card')) {
                const index = parseInt(draggedElement.dataset.index);
                player = teams[currentBattleDate].availablePlayers[index];
                teams[currentBattleDate].availablePlayers.splice(index, 1);
            } else {
                const oldBrigade = draggedElement.dataset.brigade;
                const oldSquad = parseInt(draggedElement.dataset.squad);
                const oldMember = parseInt(draggedElement.dataset.member);
                player = teams[currentBattleDate][oldBrigade][oldSquad][oldMember];
                teams[currentBattleDate][oldBrigade][oldSquad].splice(oldMember, 1);
            }

            // 计算插入位置
            const dropTarget = e.target.closest('.squad-member');
            if (dropTarget) {
                const targetIndex = parseInt(dropTarget.dataset.member);
                teams[currentBattleDate][brigade][squadIndex].splice(targetIndex, 0, {
                    ...player,
                    startPlan: player.startPlan || '',
                    followPlan: player.followPlan || ''
                });
            } else {
                const maxMembers = parseInt(squad.dataset.max);
                const currentMembers = teams[currentBattleDate][brigade][squadIndex].length;
                if (currentMembers >= maxMembers) {
                    alert('该小队已满员（5人）');
                    return;
                }
                teams[currentBattleDate][brigade][squadIndex].push({
                    ...player,
                    startPlan: player.startPlan || '',
                    followPlan: player.followPlan || ''
                });
            }

            saveTeams();
            loadTeamData(currentBattleDate);
        }
    });

    const availableList = document.getElementById('available-players-list');
    availableList.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    availableList.addEventListener('drop', (e) => {
        e.preventDefault();

        if (!draggedElement || !draggedElement.classList.contains('squad-member')) return;

        const brigade = draggedElement.dataset.brigade;
        const squadIndex = parseInt(draggedElement.dataset.squad);
        const memberIndex = parseInt(draggedElement.dataset.member);

        const member = teams[currentBattleDate][brigade][squadIndex][memberIndex];
        teams[currentBattleDate][brigade][squadIndex].splice(memberIndex, 1);
        teams[currentBattleDate].availablePlayers.push(member);

        saveTeams();
        loadTeamData(currentBattleDate);
    });
}

// 智能配队
async function handleSmartAssign() {
    const availablePlayers = teams[currentBattleDate]?.availablePlayers || [];
    if (availablePlayers.length === 0) {
        alert('请先导入报名玩家');
        return;
    }

    showSmartAssignLoading();

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 120000); // 2分钟超时

        const response = await fetch('/api/smart-assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                players: teams[currentBattleDate].availablePlayers
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        // 检查响应是否正常
        if (!response.ok) {
            throw new Error(`服务器错误: ${response.status}`);
        }

        // 检查响应内容类型
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('服务器返回了非JSON格式的数据');
        }

        const result = await response.json();

        if (result.success) {
            // 确保数据结构正确
            teams[currentBattleDate].attack = result.assignment.attack || [[], [], []];
            teams[currentBattleDate].defense = result.assignment.defense || [[], [], []];
            teams[currentBattleDate].availablePlayers = result.assignment.remaining || [];
            saveTeams();
            renderAvailablePlayers(teams[currentBattleDate].availablePlayers);
            renderTeams(currentBattleDate);
            hideLoading();
            alert('智能配队完成！');
        } else {
            throw new Error(result.error || '配队失败');
        }
    } catch (error) {
        hideLoading();
        if (error.name === 'AbortError') {
            alert('智能配队超时，请检查网络连接后重试');
        } else {
            alert('智能配队失败：' + error.message);
        }
        console.error('智能配队错误:', error);
    }
}

// 导出为图片
async function handleExportTeam() {
    showLoading('正在生成图片...');

    try {
        const exportContainer = document.createElement('div');
        exportContainer.style.cssText = `
            position: fixed;
            left: -9999px;
            top: 0;
            width: 1600px;
            padding: 80px 100px;
            background: #f2f0eb;
            font-family: 'KaiTi', 'STKaiti', 'SimSun', serif;
            border-left: 16px solid #3d3d3d;
            border-right: 16px solid #3d3d3d;
            box-shadow: inset 0 0 80px rgba(0,0,0,0.08);
        `;

        const teamData = teams[currentBattleDate];

        // 全局统一字号：遍历所有成员找最长文字，算出统一字号和行高
        let maxPlanLen = 0;
        let maxIdLen = 0;
        ['attack', 'defense'].forEach(brigade => {
            teamData[brigade].forEach(squad => {
                squad.forEach(member => {
                    if (!member) return;
                    maxPlanLen = Math.max(maxPlanLen, (member.startPlan || '').length, (member.followPlan || '').length);
                    maxIdLen = Math.max(maxIdLen, (member.id || '').length);
                });
            });
        });
        const planFontSize = maxPlanLen <= 12 ? 14 : maxPlanLen <= 24 ? 12 : maxPlanLen <= 36 ? 10 : 9;
        // 玩家名字号：列宽约18%*卡片宽，估算可容纳字数，超出则缩小
        const idFontSize = maxIdLen <= 4 ? 17 : maxIdLen <= 6 ? 15 : maxIdLen <= 8 ? 13 : 11;
        // 行高：取 plan 和 id 两者所需行数的最大值
        const maxLines = Math.max(maxPlanLen <= 12 ? 1 : 2, maxIdLen <= 6 ? 1 : 2);
        const rowHeight = Math.max(planFontSize, idFontSize) * 1.4 * maxLines + 18;

        let content = `
            <div style="position: relative;">
                <!-- 水墨晕染背景 -->
                <div style="position: absolute; inset: 0; background:
                    radial-gradient(circle at 15% 20%, rgba(0,0,0,0.03) 0%, transparent 40%),
                    radial-gradient(circle at 85% 80%, rgba(0,0,0,0.04) 0%, transparent 50%),
                    radial-gradient(circle at 50% 50%, rgba(0,0,0,0.02) 0%, transparent 60%);
                    pointer-events: none;"></div>
                <!-- 墨迹晕染左上 -->
                <div style="position: absolute; width: 500px; height: 350px; top: -80px; left: -80px; opacity: 0.08;
                    background: radial-gradient(ellipse at center, rgba(44,44,44,1) 0%, rgba(44,44,44,0) 70%);
                    border-radius: 50%; filter: blur(20px); pointer-events: none;"></div>
                <!-- 墨迹晕染右下 -->
                <div style="position: absolute; width: 700px; height: 500px; bottom: -150px; right: -150px; opacity: 0.06;
                    background: radial-gradient(ellipse at center, rgba(44,44,44,1) 0%, rgba(44,44,44,0) 70%);
                    border-radius: 50%; filter: blur(20px); pointer-events: none;"></div>

                <!-- 左上竹叶 -->
                <div style="position: absolute; top: 30px; left: 30px; transform: scale(1.2);">
                    <div style="position: absolute; width: 70px; height: 26px; background: rgba(50,65,50,0.55); border-radius: 0 100% 0 100%; transform: rotate(-10deg); top: 0; left: 0;"></div>
                    <div style="position: absolute; width: 55px; height: 22px; background: rgba(50,65,50,0.45); border-radius: 0 100% 0 100%; transform: rotate(15deg); top: 18px; left: 35px;"></div>
                    <div style="position: absolute; width: 80px; height: 30px; background: rgba(50,65,50,0.5); border-radius: 0 100% 0 100%; transform: rotate(-25deg); top: -18px; left: 18px;"></div>
                </div>
                <!-- 右上竹叶 -->
                <div style="position: absolute; top: 30px; right: 30px; transform: scale(1.2) scaleX(-1);">
                    <div style="position: absolute; width: 70px; height: 26px; background: rgba(50,65,50,0.55); border-radius: 0 100% 0 100%; transform: rotate(-10deg); top: 0; left: 0;"></div>
                    <div style="position: absolute; width: 55px; height: 22px; background: rgba(50,65,50,0.45); border-radius: 0 100% 0 100%; transform: rotate(15deg); top: 18px; left: 35px;"></div>
                    <div style="position: absolute; width: 80px; height: 30px; background: rgba(50,65,50,0.5); border-radius: 0 100% 0 100%; transform: rotate(-25deg); top: -18px; left: 18px;"></div>
                </div>

                <!-- 左侧竖排装饰文字 -->
                <div style="position: absolute; top: 180px; left: 18px; font-size: 22px; color: rgba(44,44,44,0.3);
                    writing-mode: vertical-rl; letter-spacing: 6px; line-height: 1.5;">乾坤未定 势如破竹</div>
                <!-- 右侧竖排装饰文字 -->
                <div style="position: absolute; top: 180px; right: 18px; font-size: 22px; color: rgba(44,44,44,0.3);
                    writing-mode: vertical-rl; letter-spacing: 6px; line-height: 1.5;">运筹帷幄 决胜千里</div>

                <!-- 标题区域 -->
                <div style="text-align: center; margin-bottom: 60px; position: relative; z-index: 1; padding-top: 20px;">
                    <h1 style="font-size: 72px; color: #1a1a1a; margin: 0 0 20px; letter-spacing: 20px;
                        text-shadow: 4px 4px 0px rgba(0,0,0,0.1); font-weight: bold;">加州理工学院百业战安排</h1>
                    <!-- 印章 -->
                    <div style="position: absolute; right: 80px; top: 10px; width: 70px; height: 70px;
                        border: 3px solid #8B0000; color: #8B0000; font-size: 26px; line-height: 64px;
                        text-align: center; border-radius: 6px; transform: rotate(-15deg); opacity: 0.75;">机密</div>

                    <div style="display: inline-block; font-size: 26px; color: #555; letter-spacing: 4px;
                        border-top: 2px solid #8B0000; border-bottom: 2px solid #8B0000;
                        padding: 10px 40px; position: relative;">
                        <span style="position: absolute; left: -20px; top: 50%; transform: translateY(-50%); color: #8B0000; font-size: 20px;">◆</span>
                        ${currentBattleDate}
                        <span style="position: absolute; right: -20px; top: 50%; transform: translateY(-50%); color: #8B0000; font-size: 20px;">◆</span>
                    </div>
                </div>
        `;

        ['attack', 'defense'].forEach((brigade) => {
            const brigadeName = brigade === 'attack' ? '进攻大队' : '防守大队';
            const brigadeLeftPrefix = brigade === 'attack' ? '疾如' : '徐如';
            const brigadeLeftLast = brigade === 'attack' ? '风' : '林';
            const brigadeRightPrefix = brigade === 'attack' ? '侵略如' : '不动如';
            const brigadeRightLast = brigade === 'attack' ? '火' : '山';
            content += `
                <div style="margin-bottom: 60px; position: relative; z-index: 1;">
                    <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 36px;">
                        <span style="color: #8B0000; font-size: 26px; margin: 0 14px; font-family: 'STXingkai', 'STKaiti', 'KaiTi', cursive; letter-spacing: 3px; font-style: italic;">${brigadeLeftPrefix}<span style="font-size: 40px; font-weight: bold;">${brigadeLeftLast}</span></span>
                        <div style="height: 3px; width: 120px; background: linear-gradient(90deg, transparent, #8B0000, transparent);"></div>
                        <h2 style="font-size: 48px; color: #2c2c2c; margin: 0 30px; letter-spacing: 8px; font-weight: bold;">${brigadeName}</h2>
                        <div style="height: 3px; width: 120px; background: linear-gradient(90deg, transparent, #8B0000, transparent);"></div>
                        <span style="color: #8B0000; font-size: 26px; margin: 0 14px; font-family: 'STXingkai', 'STKaiti', 'KaiTi', cursive; letter-spacing: 3px; font-style: italic;">${brigadeRightPrefix}<span style="font-size: 40px; font-weight: bold;">${brigadeRightLast}</span></span>
                    </div>
                    <div style="display: flex; gap: 28px;">
            `;

            teamData[brigade].forEach((squad, squadIndex) => {
                const squadNums = ['一', '二', '三'];
                content += `
                    <div style="flex: 1; background: rgba(255,255,255,0.65);
                        border: 2px solid #4a4a4a; border-radius: 4px; padding: 22px 20px;
                        box-shadow: 8px 8px 0px rgba(0,0,0,0.1); position: relative; overflow: hidden;">
                        <!-- 内层细边框 -->
                        <div style="position: absolute; top: 6px; left: 6px; right: 6px; bottom: 6px;
                            border: 1px solid #999; pointer-events: none;"></div>

                        <h3 style="text-align: center; font-size: 28px; color: #111; margin: 0 0 18px;
                            letter-spacing: 6px; padding-bottom: 14px;
                            border-bottom: 2px solid #2c2c2c;">
                            第${squadNums[squadIndex]}小队
                        </h3>
                        <table style="width: 100%; border-collapse: collapse; table-layout: fixed;">
                            <thead>
                                <tr>
                                    <th style="padding: 10px 6px; font-size: 16px; color: #8B0000; border-bottom: 2px solid #8B0000; text-align: center; font-weight: bold; letter-spacing: 2px; width: 18%;">人员</th>
                                    <th style="padding: 10px 6px; font-size: 16px; color: #8B0000; border-bottom: 2px solid #8B0000; text-align: center; font-weight: bold; letter-spacing: 2px; width: 20%;">流派</th>
                                    <th style="padding: 10px 6px; font-size: 16px; color: #8B0000; border-bottom: 2px solid #8B0000; text-align: center; font-weight: bold; letter-spacing: 2px; width: 31%;">开局安排</th>
                                    <th style="padding: 10px 6px; font-size: 16px; color: #8B0000; border-bottom: 2px solid #8B0000; text-align: center; font-weight: bold; letter-spacing: 2px; width: 31%;">后续安排</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                for (let i = 0; i < 5; i++) {
                    const member = squad[i];
                    const prof = (member && member.professions && member.professions[0]) || '';
                    let rowBg;
                    if (prof.includes('陌')) {
                        rowBg = 'rgba(255, 165, 0, 0.25)';
                    } else if (prof.includes('奶')) {
                        rowBg = 'rgba(0, 160, 80, 0.20)';
                    } else {
                        rowBg = i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.02)';
                    }
                    const profColor = (!prof || prof.includes('陌') || prof.includes('奶')) ? '#333' : '#1565C0';
                    if (member) {
                        content += `
                            <tr style="background: ${rowBg}; border-bottom: 1px dashed #999;">
                                <td style="padding: 0 6px; height: ${rowHeight}px; font-size: ${idFontSize}px; color: #1a1a1a; font-weight: bold; letter-spacing: 1px; text-align: center; white-space: normal; word-break: break-all; line-height: 1.4;">${member.id}</td>
                                <td style="padding: 0 6px; height: ${rowHeight}px; font-size: 14px; color: ${profColor}; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${(member.professions || []).join('、')}</td>
                                <td style="padding: 0 6px; height: ${rowHeight}px; font-size: ${planFontSize}px; color: #333; text-align: center; white-space: normal; word-break: break-all; line-height: 1.4;">${member.startPlan || '—'}</td>
                                <td style="padding: 0 6px; height: ${rowHeight}px; font-size: ${planFontSize}px; color: #333; text-align: center; white-space: normal; word-break: break-all; line-height: 1.4;">${member.followPlan || '—'}</td>
                            </tr>
                        `;
                    } else {
                        content += `
                            <tr style="background: ${rowBg}; border-bottom: 1px dashed #999;">
                                <td colspan="4" style="padding: 0 6px; height: ${rowHeight}px; font-size: 14px; color: rgba(139,0,0,0.3); text-align: center; letter-spacing: 2px;">虚位以待</td>
                            </tr>
                        `;
                    }
                }

                content += `
                            </tbody>
                        </table>
                    </div>
                `;
            });

            content += `</div></div>`;
        });

        content += `
                <!-- 底部装饰 -->
                <div style="margin-top: 50px; text-align: center; position: relative; z-index: 1;">
                    <div style="display: flex; align-items: center; gap: 20px; justify-content: center;">
                        <div style="flex: 1; max-width: 400px; height: 2px; background: linear-gradient(90deg, transparent, #8B0000);"></div>
                        <span style="color: #8B0000; font-size: 20px;">◆</span>
                        <div style="font-size: 20px; color: #555; letter-spacing: 6px;">燕云百业 · 加州理工</div>
                        <span style="color: #8B0000; font-size: 20px;">◆</span>
                        <div style="flex: 1; max-width: 400px; height: 2px; background: linear-gradient(90deg, #8B0000, transparent);"></div>
                    </div>
                </div>
            </div>
        `;

        exportContainer.innerHTML = content;
        document.body.appendChild(exportContainer);

        const canvas = await html2canvas(exportContainer, {
            backgroundColor: '#f2f0eb',
            scale: 2,
            logging: false
        });

        document.body.removeChild(exportContainer);

        const link = document.createElement('a');
        link.download = `百业战配队_${currentBattleDate}.png`;
        link.href = canvas.toDataURL();
        link.click();

        hideLoading();
    } catch (error) {
        hideLoading();
        alert('导出失败：' + error.message);
    }
}

// 新建日期配队
// 更新批次下拉列表
function updateBatchSelect() {
    const dates = Object.keys(teams).sort().reverse(); // 从近到远排序
    battleDateSelect.innerHTML = '<option value="">请选择批次</option>';

    dates.forEach(date => {
        const option = document.createElement('option');
        option.value = date;
        option.textContent = date;
        battleDateSelect.appendChild(option);
    });

    // 如果有批次，默认选择最新的
    if (dates.length > 0) {
        currentBattleDate = dates[0];
        battleDateSelect.value = currentBattleDate;
        loadTeamData(currentBattleDate);
    }
}

// 显示新建批次模态框
function showNewBatchModal() {
    const modal = document.getElementById('new-batch-modal');
    const dateInput = document.getElementById('new-batch-date');
    dateInput.value = new Date().toISOString().split('T')[0];
    modal.classList.add('active');
}

// 关闭新建批次模态框
function closeNewBatchModal() {
    document.getElementById('new-batch-modal').classList.remove('active');
}

// 确认新建批次
function confirmNewBatch() {
    const dateInput = document.getElementById('new-batch-date');
    const newDate = dateInput.value;

    if (!newDate) {
        alert('请选择日期');
        return;
    }

    // 检查日期是否已存在
    if (teams[newDate]) {
        alert('该日期的批次已存在，请选择其他日期');
        return;
    }

    // 创建新批次
    teams[newDate] = {
        attack: [[], [], []],
        defense: [[], [], []],
        availablePlayers: []
    };

    saveTeams();
    updateBatchSelect();

    // 切换到新批次
    currentBattleDate = newDate;
    battleDateSelect.value = newDate;
    loadTeamData(newDate);

    closeNewBatchModal();
    alert(`已创建 ${newDate} 的百业战批次`);
}

// 智能配队专用 loading
function showSmartAssignLoading() {
    const messages = [
        '正在统计各玩家的流派和特点',
        '正在计算最合理的排兵布阵',
        '岂曰无衣，与子同袍',
        '王于兴师，修我戈矛。与子同仇！'
    ];

    const overlay = document.createElement('div');
    overlay.id = 'loading-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.75);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 320px;
        gap: 16px;
    `;

    // 进度条容器
    const barWrap = document.createElement('div');
    barWrap.style.cssText = `
        width: 100%;
        height: 6px;
        background: rgba(255,255,255,0.2);
        border-radius: 3px;
        overflow: hidden;
    `;
    const bar = document.createElement('div');
    bar.style.cssText = `
        height: 100%;
        width: 0%;
        background: linear-gradient(90deg, #4facfe, #00f2fe);
        border-radius: 3px;
        transition: width 0.4s ease;
    `;
    barWrap.appendChild(bar);

    // 文案
    const label = document.createElement('div');
    label.style.cssText = `
        color: white;
        font-size: 16px;
        text-align: center;
        min-height: 24px;
        opacity: 1;
        transition: opacity 0.3s ease;
    `;
    label.textContent = messages[0];

    box.appendChild(barWrap);
    box.appendChild(label);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // 进度条动画：匀速走到 90%，剩余留给真实完成
    const totalDuration = messages.length * 1500; // 6000ms
    const startTime = Date.now();
    const progressTimer = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const pct = Math.min(90, (elapsed / totalDuration) * 90);
        bar.style.width = pct + '%';
        if (pct >= 90) clearInterval(progressTimer);
    }, 50);
    overlay._progressTimer = progressTimer;
    overlay._bar = bar;

    // 文案轮播
    let idx = 0;
    const textTimer = setInterval(() => {
        idx++;
        if (idx >= messages.length) {
            clearInterval(textTimer);
            return;
        }
        label.style.opacity = '0';
        setTimeout(() => {
            label.textContent = messages[idx];
            label.style.opacity = '1';
        }, 300);
    }, 1500);
    overlay._textTimer = textTimer;
}

// 加载提示
function showLoading(message) {
    const loading = document.createElement('div');
    loading.id = 'loading-overlay';
    loading.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        color: white;
        font-size: 18px;
    `;
    loading.textContent = message;
    document.body.appendChild(loading);
}

function hideLoading() {
    const loading = document.getElementById('loading-overlay');
    if (loading) {
        if (loading._progressTimer) clearInterval(loading._progressTimer);
        if (loading._textTimer) clearInterval(loading._textTimer);
        if (loading._bar) {
            loading._bar.style.transition = 'width 0.3s ease';
            loading._bar.style.width = '100%';
            setTimeout(() => loading.remove(), 350);
        } else {
            loading.remove();
        }
    }
}

// 添加报名玩家功能
let selectedPlayerIds = new Set(); // 用于跟踪选中的玩家ID

function showAddRegistrationModal() {
    const modal = document.getElementById('add-registration-modal');
    const searchInput = document.getElementById('search-player-input');

    // 清空搜索框
    searchInput.value = '';

    // 初始化选中状态（从当前报名玩家列表和已配队玩家）
    if (!teams[currentBattleDate]) {
        teams[currentBattleDate] = {
            attack: [[], [], []],
            defense: [[], [], []],
            availablePlayers: []
        };
    }

    // 收集所有已在配队中的玩家ID
    const assignedPlayerIds = new Set();
    teams[currentBattleDate].attack.forEach(squad => {
        squad.forEach(member => assignedPlayerIds.add(member.id));
    });
    teams[currentBattleDate].defense.forEach(squad => {
        squad.forEach(member => assignedPlayerIds.add(member.id));
    });

    // 合并可用玩家和已配队玩家
    selectedPlayerIds = new Set([
        ...teams[currentBattleDate].availablePlayers.map(p => p.id),
        ...assignedPlayerIds
    ]);

    // 渲染玩家列表
    renderPlayerSelectionList();

    // 添加搜索功能
    searchInput.oninput = () => {
        renderPlayerSelectionList(searchInput.value.trim());
    };

    modal.classList.add('active');
}

function closeAddRegistrationModal() {
    document.getElementById('add-registration-modal').classList.remove('active');
}

function renderPlayerSelectionList(searchTerm = '') {
    const container = document.getElementById('player-selection-list');
    container.innerHTML = '';

    // 过滤玩家
    const filteredPlayers = players.filter(p => {
        if (searchTerm) {
            return p.id.includes(searchTerm);
        }
        return true;
    });

    if (filteredPlayers.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">没有找到玩家</div>';
        return;
    }

    // 渲染玩家列表
    filteredPlayers.forEach(player => {
        const isSelected = selectedPlayerIds.has(player.id);
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 10px;
            border-bottom: 1px solid #eee;
            display: flex;
            align-items: center;
            cursor: pointer;
        `;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isSelected;
        checkbox.dataset.playerId = player.id;
        checkbox.style.marginRight = '10px';

        const label = document.createElement('label');
        label.style.cssText = 'flex: 1; cursor: pointer; display: flex; justify-content: space-between;';
        label.innerHTML = `
            <span style="font-weight: bold;">${player.id}</span>
            <span style="color: #666; font-size: 14px;">${player.professions.join('、')}</span>
        `;

        // 点击整行切换checkbox和状态
        item.onclick = (e) => {
            e.stopPropagation();
            checkbox.checked = !checkbox.checked;

            // 更新全局状态
            if (checkbox.checked) {
                selectedPlayerIds.add(player.id);
            } else {
                selectedPlayerIds.delete(player.id);
            }
        };

        // 点击checkbox本身也更新状态
        checkbox.onclick = (e) => {
            e.stopPropagation();

            // 更新全局状态
            if (checkbox.checked) {
                selectedPlayerIds.add(player.id);
            } else {
                selectedPlayerIds.delete(player.id);
            }
        };

        item.appendChild(checkbox);
        item.appendChild(label);
        container.appendChild(item);
    });
}

function confirmAddRegistration() {
    // 确保当前日期的队伍数据存在
    if (!teams[currentBattleDate]) {
        teams[currentBattleDate] = {
            attack: [[], [], []],
            defense: [[], [], []],
            availablePlayers: []
        };
    }

    // 收集所有已在配队中的玩家ID
    const assignedPlayerIds = new Set();
    teams[currentBattleDate].attack.forEach(squad => {
        squad.forEach(member => assignedPlayerIds.add(member.id));
    });
    teams[currentBattleDate].defense.forEach(squad => {
        squad.forEach(member => assignedPlayerIds.add(member.id));
    });

    // 更新可用玩家列表（排除已配队的玩家）
    const newAvailablePlayers = [];
    selectedPlayerIds.forEach(id => {
        // 只添加未在配队中的玩家
        if (!assignedPlayerIds.has(id)) {
            const player = players.find(p => p.id === id);
            if (player) {
                newAvailablePlayers.push({...player});
            }
        }
    });

    teams[currentBattleDate].availablePlayers = newAvailablePlayers;
    saveTeams();
    renderAvailablePlayers(teams[currentBattleDate].availablePlayers);
    closeAddRegistrationModal();

    alert(`已更新报名玩家，当前共 ${newAvailablePlayers.length} 人`);
}

// ==================== 百业抽奖助手功能 ====================
let selectedLotteryPlayers = new Set();
let currentEditingLotteryIndex = null;

// 保存抽奖数据
async function saveLotteries() {
    try {
        const response = await fetch('/api/lotteries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lotteries)
        });
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || '保存失败');
        }
        scheduleSyncStatusCheck();
        return true;
    } catch (error) {
        console.error('保存抽奖数据失败:', error);
        alert('保存抽奖数据失败：' + error.message);
        return false;
    }
}

// 渲染抽奖记录表格
function renderLotteryTable() {
    const tbody = document.getElementById('lottery-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    // 按创建时间从近到远排序
    const sortedLotteries = [...lotteries].sort((a, b) =>
        new Date(b.createTime) - new Date(a.createTime)
    );

    sortedLotteries.forEach((lottery, index) => {
        const originalIndex = lotteries.findIndex(l => l.id === lottery.id);
        const tr = document.createElement('tr');

        // 格式化创建时间
        const createTime = new Date(lottery.createTime).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        // 奖品列表
        const prizesHtml = lottery.prizes.join('<br>');

        // 中奖玩家
        let winnersHtml = '-';
        if (lottery.winners && lottery.winners.length > 0) {
            winnersHtml = lottery.winners.map((winner, idx) =>
                `${lottery.prizes[idx]}：${winner}`
            ).join('<br>');
        }

        // 操作按钮
        let actionsHtml = '';
        if (lottery.winners && lottery.winners.length > 0) {
            actionsHtml = `
                <button class="btn btn-secondary" onclick="viewLottery(${originalIndex})">查看</button>
                <button class="btn btn-danger" onclick="deleteLottery(${originalIndex})">删除</button>
            `;
        } else {
            actionsHtml = `
                <button class="btn btn-primary" onclick="drawLottery(${originalIndex})">抽奖</button>
                <button class="btn btn-secondary" onclick="editLottery(${originalIndex})">编辑</button>
                <button class="btn btn-danger" onclick="deleteLottery(${originalIndex})">删除</button>
            `;
        }

        tr.innerHTML = `
            <td>${createTime}</td>
            <td>${lottery.name}</td>
            <td>${prizesHtml}</td>
            <td>${lottery.playerIds.length}</td>
            <td>${winnersHtml}</td>
            <td>${actionsHtml}</td>
        `;
        tbody.appendChild(tr);
    });
}

// 打开新建/编辑抽奖弹窗
function openLotteryModal(lotteryIndex = null) {
    const modal = document.getElementById('lottery-modal');
    const title = document.getElementById('lottery-modal-title');
    const form = document.getElementById('lottery-form');
    const submitBtn = document.getElementById('lottery-submit-btn');

    // 重置表单
    form.reset();
    selectedLotteryPlayers.clear();
    currentEditingLotteryIndex = lotteryIndex;

    if (lotteryIndex !== null) {
        const lottery = lotteries[lotteryIndex];
        const isDrawn = lottery.winners && lottery.winners.length > 0;

        title.textContent = isDrawn ? '查看抽奖' : '编辑抽奖';
        submitBtn.textContent = isDrawn ? '关闭' : '保存';

        // 填充数据
        document.getElementById('lottery-name').value = lottery.name;
        document.getElementById('lottery-winner-count').value = lottery.winnerCount;

        // 填充奖品
        updatePrizesInputs(lottery.winnerCount, lottery.prizes);

        // 填充玩家：未开奖抽奖池跟随人才库，同时保留本次抽奖手动剔除名单。
        const playerIds = isDrawn ? lottery.playerIds : normalizePendingLotteryPool(lottery);
        playerIds.forEach(id => selectedLotteryPlayers.add(id));

        // 如果已抽奖，禁用所有输入
        if (isDrawn) {
            form.querySelectorAll('input, select').forEach(el => el.disabled = true);
            submitBtn.type = 'button';
            submitBtn.onclick = closeLotteryModal;
        } else {
            form.querySelectorAll('input, select').forEach(el => el.disabled = false);
            submitBtn.type = 'submit';
            submitBtn.onclick = null;
        }
    } else {
        title.textContent = '新建抽奖';
        submitBtn.textContent = '创建';
        submitBtn.type = 'submit';
        submitBtn.onclick = null;
        form.querySelectorAll('input, select').forEach(el => el.disabled = false);
        updatePrizesInputs(1);
        getTalentPlayerIds().forEach(id => selectedLotteryPlayers.add(id));
    }

    renderLotteryPlayerList();
    updateLotterySelectedPreview();

    modal.classList.add('active');
}

// 关闭抽奖弹窗
function closeLotteryModal() {
    document.getElementById('lottery-modal').classList.remove('active');
    selectedLotteryPlayers.clear();
    currentEditingLotteryIndex = null;
}

// 更新奖品输入框
function updatePrizesInputs(count, prizes = []) {
    const container = document.getElementById('lottery-prizes-container');
    container.innerHTML = '';

    for (let i = 0; i < count; i++) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'lottery-prize-input';
        input.placeholder = `奖品${i + 1}`;
        input.required = true;
        input.value = prizes[i] || '';
        input.style.marginBottom = '8px';
        container.appendChild(input);
    }
}

// 渲染玩家选择列表
function renderLotteryPlayerList(searchTerm = '') {
    const container = document.getElementById('lottery-player-list');
    container.innerHTML = '';

    const filteredPlayers = players.filter(p => {
        if (searchTerm) {
            return p.id.includes(searchTerm);
        }
        return true;
    });

    if (filteredPlayers.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">没有找到玩家</div>';
        return;
    }

    filteredPlayers.forEach(player => {
        const isSelected = selectedLotteryPlayers.has(player.id);
        const lockSelection = currentEditingLotteryIndex !== null && isLotteryDrawn(lotteries[currentEditingLotteryIndex]);
        const item = document.createElement('div');
        item.style.cssText = `
            padding: 10px;
            border-bottom: 1px solid #eee;
            display: flex;
            align-items: center;
            cursor: ${lockSelection ? 'default' : 'pointer'};
        `;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isSelected;
        checkbox.disabled = lockSelection;
        checkbox.style.marginRight = '10px';

        const label = document.createElement('label');
        label.style.cssText = `flex: 1; cursor: ${lockSelection ? 'default' : 'pointer'}; display: flex; justify-content: space-between;`;
        label.innerHTML = `
            <span style="font-weight: bold;">${player.id}</span>
            <span style="color: #666; font-size: 14px;">${player.professions.join('、')}</span>
        `;

        // 点击整行切换checkbox和状态
        item.onclick = (e) => {
            e.stopPropagation();
            if (lockSelection) return;
            checkbox.checked = !checkbox.checked;

            // 更新全局状态
            if (checkbox.checked) {
                selectedLotteryPlayers.add(player.id);
            } else {
                selectedLotteryPlayers.delete(player.id);
            }
            updateLotterySelectedPreview();
        };

        // 点击checkbox本身也更新状态
        checkbox.onclick = (e) => {
            e.stopPropagation();
            if (lockSelection) return;

            // 更新全局状态
            if (checkbox.checked) {
                selectedLotteryPlayers.add(player.id);
            } else {
                selectedLotteryPlayers.delete(player.id);
            }
            updateLotterySelectedPreview();
        };

        item.appendChild(checkbox);
        item.appendChild(label);
        container.appendChild(item);
    });
}

// 更新已选玩家预览
function updateLotterySelectedPreview() {
    const tagsContainer = document.getElementById('lottery-selected-tags');
    const countEl = document.getElementById('lottery-selected-count');

    tagsContainer.innerHTML = '';

    selectedLotteryPlayers.forEach(playerId => {
        const tag = document.createElement('span');
        tag.className = 'lottery-selected-tag';
        tag.title = '点击从本次待抽奖名单中剔除';
        tag.innerHTML = `
            <span class="lottery-selected-tag-label">${playerId}</span>
            <button type="button" class="lottery-selected-tag-delete" aria-label="删除玩家">×</button>
        `;
        const deleteBtn = tag.querySelector('.lottery-selected-tag-delete');
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            const lottery = currentEditingLotteryIndex !== null ? lotteries[currentEditingLotteryIndex] : null;
            if (lottery && isLotteryDrawn(lottery)) return;
            selectedLotteryPlayers.delete(playerId);
            updateLotterySelectedPreview();
            renderLotteryPlayerList(document.getElementById('lottery-player-search')?.value.trim() || '');
        };
        tagsContainer.appendChild(tag);
    });

    countEl.textContent = `当前已添加${selectedLotteryPlayers.size}名玩家`;
}

// 提交抽奖表单
async function handleLotterySubmit(e) {
    e.preventDefault();

    const name = document.getElementById('lottery-name').value.trim();
    const winnerCount = parseInt(document.getElementById('lottery-winner-count').value);
    const prizeInputs = document.querySelectorAll('.lottery-prize-input');
    const prizes = Array.from(prizeInputs).map(input => input.value.trim());
    const lotteryPlayerIds = Array.from(selectedLotteryPlayers);
    const excludedPlayerIds = getLotteryExcludedPlayerIds(lotteryPlayerIds);

    // 验证
    if (!name) {
        alert('请补充信息');
        return;
    }

    if (prizes.some(p => !p)) {
        alert('请补充信息');
        return;
    }

    if (lotteryPlayerIds.length === 0) {
        alert('请补充信息');
        return;
    }

    if (lotteryPlayerIds.length < winnerCount) {
        alert('玩家名单数不能少于可中奖人数');
        return;
    }

    const lotteryData = {
        id: currentEditingLotteryIndex !== null ? lotteries[currentEditingLotteryIndex].id : Date.now(),
        name,
        winnerCount,
        prizes,
        playerIds: lotteryPlayerIds,
        excludedPlayerIds,
        createTime: currentEditingLotteryIndex !== null ? lotteries[currentEditingLotteryIndex].createTime : new Date().toISOString(),
        winners: currentEditingLotteryIndex !== null ? lotteries[currentEditingLotteryIndex].winners : null
    };

    if (currentEditingLotteryIndex !== null) {
        lotteries[currentEditingLotteryIndex] = lotteryData;
    } else {
        lotteries.push(lotteryData);
    }

    const saved = await saveLotteries();
    if (saved) {
        renderLotteryTable();
        closeLotteryModal();
    }
}

// 编辑抽奖
function editLottery(index) {
    openLotteryModal(index);
}

// 查看抽奖
function viewLottery(index) {
    openLotteryModal(index);
}

// 删除抽奖
async function deleteLottery(index) {
    if (confirm('确定删除该抽奖记录吗？')) {
        lotteries.splice(index, 1);
        const saved = await saveLotteries();
        if (saved) {
            renderLotteryTable();
        }
    }
}

// 执行抽奖
async function drawLottery(index) {
    const lottery = lotteries[index];

    if (confirm(`确定要为"${lottery.name}"进行抽奖吗？抽奖后将无法修改。`)) {
        // 计算中奖玩家（考虑历史中奖记录）
        const winners = calculateWinnersWithHistory(lottery.playerIds, lottery.winnerCount);
        const previousWinners = lottery.winners;

        // 先保存中奖结果，再播放动画，避免页面刷新或动画中断导致历史记录丢失。
        lottery.winners = winners;
        const saved = await saveLotteries();
        if (!saved) {
            lottery.winners = previousWinners;
            return;
        }
        renderLotteryTable();

        // 显示抽奖动画
        showLotteryAnimation(lottery.playerIds, winners, lottery.prizes, () => {
            renderLotteryTable();
        });
    }
}

// 计算中奖玩家（考虑历史中奖记录）
function calculateWinnersWithHistory(playerIds, winnerCount) {
    // 黑名单：这些玩家永远无法中奖
    const blacklist = ['柴喵', '斩红郎', '鬼公仔', '费曼'];

    // 过滤掉黑名单玩家，只从可中奖玩家中选择
    const eligiblePlayers = playerIds.filter(id => !blacklist.includes(id));

    // 如果可中奖玩家数量不足，返回所有可中奖玩家
    if (eligiblePlayers.length <= winnerCount) {
        return eligiblePlayers;
    }

    // 统计每个玩家的历史中奖次数和最近中奖时间
    const playerWeights = {};

    eligiblePlayers.forEach(id => {
        playerWeights[id] = {
            winCount: 0,
            lastWinTime: null,
            weight: 1.0
        };
    });

    // 遍历所有历史抽奖记录
    lotteries.forEach(lot => {
        if (lot.winners && lot.winners.length > 0) {
            lot.winners.forEach(winnerId => {
                if (playerWeights[winnerId]) {
                    playerWeights[winnerId].winCount++;
                    const winTime = new Date(lot.createTime).getTime();
                    if (!playerWeights[winnerId].lastWinTime || winTime > playerWeights[winnerId].lastWinTime) {
                        playerWeights[winnerId].lastWinTime = winTime;
                    }
                }
            });
        }
    });

    // 计算权重：中奖次数越多、距离上次中奖时间越近，权重越低
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    eligiblePlayers.forEach(id => {
        const data = playerWeights[id];

        // 基础权重衰减：每中奖一次，权重降低30%
        data.weight *= Math.pow(0.7, data.winCount);

        // 时间衰减：如果30天内中过奖，额外降低权重
        if (data.lastWinTime) {
            const daysSinceWin = (now - data.lastWinTime) / (24 * 60 * 60 * 1000);
            if (daysSinceWin < 30) {
                // 30天内中奖，权重额外降低 (1 - daysSinceWin/30) * 50%
                const timePenalty = (1 - daysSinceWin / 30) * 0.5;
                data.weight *= (1 - timePenalty);
            }
        }

        // 确保权重不为0
        data.weight = Math.max(data.weight, 0.1);
    });

    // 加权随机抽取
    const winners = [];
    const remainingPlayers = [...eligiblePlayers];

    for (let i = 0; i < winnerCount && remainingPlayers.length > 0; i++) {
        // 计算总权重
        const totalWeight = remainingPlayers.reduce((sum, id) => sum + playerWeights[id].weight, 0);

        // 随机选择
        let random = Math.random() * totalWeight;
        let selectedId = null;

        for (const id of remainingPlayers) {
            random -= playerWeights[id].weight;
            if (random <= 0) {
                selectedId = id;
                break;
            }
        }

        if (!selectedId) {
            selectedId = remainingPlayers[remainingPlayers.length - 1];
        }

        winners.push(selectedId);
        remainingPlayers.splice(remainingPlayers.indexOf(selectedId), 1);
    }

    return winners;
}

function renderArcheryEggLotteryAnimation(container, allPlayers, winners, prizes, onComplete) {
    ensureArcheryLotteryStyles();

    const stage = document.createElement('div');
    stage.className = 'archery-lottery-stage';
    container.appendChild(stage);

    const header = document.createElement('div');
    header.className = 'archery-lottery-header';
    stage.appendChild(header);

    const title = document.createElement('div');
    title.className = 'archery-lottery-title';
    title.textContent = '百业飞羽定魁';
    header.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.className = 'archery-lottery-subtitle';
    subtitle.textContent = '箭过群名，落处即为本轮中奖玩家';
    header.appendChild(subtitle);

    const field = document.createElement('div');
    field.className = 'archery-lottery-field';
    stage.appendChild(field);

    const bow = document.createElement('div');
    bow.className = 'archery-bow';
    bow.innerHTML = '<div class="archery-bow-string"></div><div class="archery-bow-arc"></div>';
    field.appendChild(bow);

    const chargeRing = document.createElement('div');
    chargeRing.className = 'archery-charge-ring';
    field.appendChild(chargeRing);

    const aimLine = document.createElement('div');
    aimLine.className = 'archery-aim-line';
    field.appendChild(aimLine);

    const arrowTrail = document.createElement('div');
    arrowTrail.className = 'archery-arrow-trail';
    field.appendChild(arrowTrail);

    const arrow = document.createElement('div');
    arrow.className = 'archery-arrow';
    arrow.innerHTML = '<span class="archery-arrow-head"></span><span class="archery-arrow-shaft"></span><span class="archery-arrow-fletching"></span>';
    field.appendChild(arrow);

    const eggsArea = document.createElement('div');
    eggsArea.className = 'archery-eggs-area';
    field.appendChild(eggsArea);

    const resultPanel = document.createElement('div');
    resultPanel.className = 'archery-result-panel';
    field.appendChild(resultPanel);

    const sfx = createArcherySfx();
    const visiblePlayers = buildVisibleLotteryPlayers(allPlayers, winners);
    const eggMap = new Map();

    visiblePlayers.forEach((playerId, index) => {
        const egg = document.createElement('div');
        egg.className = 'archery-egg';
        egg.dataset.playerId = playerId;
        egg.style.setProperty('--egg-delay', `${(index % 12) * 0.04}s`);

        const shine = document.createElement('div');
        shine.className = 'archery-egg-shine';
        egg.appendChild(shine);

        const name = document.createElement('div');
        name.className = 'archery-egg-name';
        name.textContent = playerId;
        name.style.fontSize = getEggNameFontSize(playerId);
        egg.appendChild(name);

        eggsArea.appendChild(egg);
        if (!eggMap.has(playerId)) {
            eggMap.set(playerId, egg);
        }
    });

    requestAnimationFrame(() => runArrowSequence(0));

    function runArrowSequence(winnerIndex) {
        if (winnerIndex >= winners.length) {
            showFinalResults();
            return;
        }

        const winner = winners[winnerIndex];
        const prizeName = prizes[winnerIndex] || `奖品${winnerIndex + 1}`;
        const targetEgg = eggMap.get(winner);

        title.textContent = prizeName;
        subtitle.textContent = `第 ${winnerIndex + 1} 箭正在寻找目标`;

        if (!targetEgg) {
            runArrowSequence(winnerIndex + 1);
            return;
        }

        resetArrow();
        eggsArea.querySelectorAll('.archery-egg').forEach(egg => {
            egg.classList.remove('is-aimed', 'is-target');
        });

        const sweepList = buildSweepList(visiblePlayers, winner);
        let sweepIndex = 0;

        const sweepTimer = setInterval(() => {
            const aimedPlayer = sweepList[sweepIndex % sweepList.length];
            const aimedEgg = eggMap.get(aimedPlayer);
            eggsArea.querySelectorAll('.archery-egg.is-aimed').forEach(egg => egg.classList.remove('is-aimed'));
            if (aimedEgg) aimedEgg.classList.add('is-aimed');
            sweepIndex++;
        }, 95);

        setTimeout(() => {
            clearInterval(sweepTimer);
            eggsArea.querySelectorAll('.archery-egg.is-aimed').forEach(egg => egg.classList.remove('is-aimed'));
            targetEgg.classList.add('is-aimed', 'is-target');
            targetEgg.style.opacity = '1';
            shootArrowAt(targetEgg, () => {
                targetEgg.classList.remove('is-aimed');
                targetEgg.classList.add('is-hit', 'is-winner', 'is-target');
                createImpactBurst(targetEgg);
                addResultChip(prizeName, winner);
                subtitle.textContent = `射中 ${winner}`;

                setTimeout(() => {
                    runArrowSequence(winnerIndex + 1);
                }, 1050);
            });
        }, 1900 + winnerIndex * 250);
    }

    function shootArrowAt(targetEgg, done) {
        const fieldRect = field.getBoundingClientRect();
        const eggRect = targetEgg.getBoundingClientRect();
        const targetX = eggRect.left - fieldRect.left + eggRect.width * 0.46;
        const targetY = eggRect.top - fieldRect.top + eggRect.height * 0.5;
        const bowRect = bow.getBoundingClientRect();
        const bowLeft = bowRect.left - fieldRect.left;
        const startX = bowLeft + (bowRect.width <= 70 ? 22 : 30);
        const startY = fieldRect.height / 2;
        const distanceX = targetX - startX;
        const distanceY = targetY - startY;
        const angle = Math.atan2(distanceY, distanceX) * 180 / Math.PI;
        const arrowLength = parseFloat(getComputedStyle(arrow).width) || 176;
        const finalNockX = targetX - Math.cos(angle * Math.PI / 180) * arrowLength;
        const finalNockY = targetY - Math.sin(angle * Math.PI / 180) * arrowLength;

        bow.style.top = '50%';
        arrow.style.transition = 'none';
        arrow.style.opacity = '1';
        arrow.style.left = `${startX}px`;
        arrow.style.top = `${startY}px`;
        arrow.style.transform = `translate(0, -50%) rotate(${angle}deg)`;
        chargeRing.style.left = `${startX}px`;
        chargeRing.style.top = `${startY}px`;
        aimLine.style.left = `${startX}px`;
        aimLine.style.top = `${startY}px`;
        aimLine.style.width = `${Math.max(0, Math.hypot(distanceX, distanceY) - 42)}px`;
        aimLine.style.transform = `translateY(-50%) rotate(${angle}deg)`;
        arrowTrail.style.left = `${startX}px`;
        arrowTrail.style.top = `${startY}px`;
        arrowTrail.style.width = '0px';
        arrowTrail.style.transform = `translateY(-50%) rotate(${angle}deg)`;
        bow.classList.add('is-drawn', 'is-charging');
        chargeRing.classList.add('is-charging');
        aimLine.classList.add('is-visible');
        sfx.draw();

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    sfx.release();
                    bow.classList.remove('is-drawn', 'is-charging');
                    bow.classList.add('is-releasing');
                    chargeRing.classList.remove('is-charging');
                    chargeRing.classList.add('is-release');
                    aimLine.classList.remove('is-visible');
                    arrowTrail.classList.add('is-flying');
                    arrowTrail.style.transition = 'width 1.8s cubic-bezier(0.18, 0.88, 0.2, 1), opacity 1.8s ease';
                    arrowTrail.style.width = `${Math.max(80, Math.hypot(distanceX, distanceY) - 30)}px`;
                    arrow.style.transition = 'left 1.8s cubic-bezier(0.18, 0.88, 0.2, 1), top 1.8s cubic-bezier(0.18, 0.88, 0.2, 1), transform 1.8s cubic-bezier(0.18, 0.88, 0.2, 1), filter 1.8s ease';
                    arrow.style.left = `${finalNockX}px`;
                    arrow.style.top = `${finalNockY}px`;
                    arrow.style.transform = `translate(0, -50%) rotate(${angle}deg)`;
                    arrow.style.filter = 'drop-shadow(0 0 26px rgba(245, 196, 95, 0.95)) drop-shadow(0 0 58px rgba(213, 70, 54, 0.52))';
                }, 820);
            });
        });

        setTimeout(() => {
            bow.classList.remove('is-releasing');
            chargeRing.classList.remove('is-release');
            arrowTrail.classList.remove('is-flying');
            arrowTrail.style.transition = 'none';
            arrowTrail.style.opacity = '';
            arrow.style.filter = '';
            done();
        }, 2680);
    }

    function resetArrow() {
        arrow.style.transition = 'none';
        arrow.style.opacity = '0';
        arrow.style.left = '7%';
        arrow.style.top = '50%';
        arrow.style.transform = 'translate(0, -50%) rotate(0deg)';
        arrow.style.filter = '';
        bow.style.top = '50%';
        chargeRing.classList.remove('is-charging', 'is-release');
        aimLine.classList.remove('is-visible');
        arrowTrail.classList.remove('is-flying');
        arrowTrail.style.transition = 'none';
        arrowTrail.style.width = '0px';
    }

    function addResultChip(prizeName, winner) {
        const chip = document.createElement('div');
        chip.className = 'archery-result-chip';

        const prize = document.createElement('span');
        prize.className = 'archery-result-prize';
        prize.textContent = prizeName;
        chip.appendChild(prize);

        const name = document.createElement('strong');
        name.textContent = winner;
        chip.appendChild(name);

        resultPanel.appendChild(chip);
    }

    function showFinalResults() {
        title.textContent = '中奖名单';
        subtitle.textContent = '飞羽已定，恭喜以下玩家';
        arrow.style.opacity = '0';
        field.classList.add('showing-final');

        const finalList = document.createElement('div');
        finalList.className = 'archery-final-list';

        winners.forEach((winner, index) => {
            const card = document.createElement('div');
            card.className = 'archery-final-card';
            card.style.setProperty('--final-delay', `${index * 0.12}s`);

            const prize = document.createElement('span');
            prize.textContent = prizes[index] || `奖品${index + 1}`;
            card.appendChild(prize);

            const name = document.createElement('strong');
            name.textContent = winner;
            name.style.fontSize = getFinalWinnerFontSize(winner);
            card.appendChild(name);

            finalList.appendChild(card);
        });

        field.appendChild(finalList);

        setTimeout(() => {
            container.style.display = 'none';
            container.innerHTML = '';
            onComplete();
        }, 4600);
    }

    function createImpactBurst(targetEgg) {
        const fieldRect = field.getBoundingClientRect();
        const eggRect = targetEgg.getBoundingClientRect();
        const burst = document.createElement('div');
        burst.className = 'archery-impact-burst';
        burst.style.left = `${eggRect.left - fieldRect.left + eggRect.width / 2}px`;
        burst.style.top = `${eggRect.top - fieldRect.top + eggRect.height / 2}px`;
        field.appendChild(burst);

        targetEgg.classList.add('is-cracked');
        sfx.hit();

        for (let i = 0; i < 34; i++) {
            const spark = document.createElement('span');
            const angle = (Math.PI * 2 * i) / 34;
            const distance = 72 + Math.random() * 92;
            spark.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`);
            spark.style.setProperty('--spark-y', `${Math.sin(angle) * distance}px`);
            spark.style.animationDelay = `${Math.random() * 0.08}s`;
            burst.appendChild(spark);
        }

        setTimeout(() => burst.remove(), 1250);
    }

    function buildSweepList(players, winner) {
        const shuffled = [...players].sort(() => Math.random() - 0.5);
        const withoutWinner = shuffled.filter(player => player !== winner);
        return [...withoutWinner.slice(0, 20), winner];
    }

    function buildVisibleLotteryPlayers(players, selectedWinners) {
        const uniquePlayers = Array.from(new Set(players));
        const winnerSet = new Set(selectedWinners);
        const nonWinners = uniquePlayers.filter(player => !winnerSet.has(player)).sort(() => Math.random() - 0.5);
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1200;
        const maxVisible = Math.max(selectedWinners.length, Math.min(viewportWidth <= 760 ? 12 : 24, uniquePlayers.length));
        const fillerCount = Math.max(0, maxVisible - selectedWinners.length);
        return [...selectedWinners, ...nonWinners.slice(0, fillerCount)].sort(() => Math.random() - 0.5);
    }

    function getEggNameFontSize(name) {
        if (name.length <= 3) return '22px';
        if (name.length <= 5) return '18px';
        if (name.length <= 7) return '15px';
        return '13px';
    }

    function getFinalWinnerFontSize(name) {
        if (name.length <= 3) return '64px';
        if (name.length <= 5) return '52px';
        if (name.length <= 7) return '42px';
        if (name.length <= 10) return '34px';
        return '28px';
    }

    function createArcherySfx() {
        let audioCtx = null;

        function getContext() {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            return audioCtx;
        }

        function tone({ frequency, endFrequency, duration, type = 'sine', gain = 0.1, delay = 0 }) {
            if (!window.AudioContext && !window.webkitAudioContext) return;
            const ctx = getContext();
            const start = ctx.currentTime + delay;
            const oscillator = ctx.createOscillator();
            const volume = ctx.createGain();

            oscillator.type = type;
            oscillator.frequency.setValueAtTime(frequency, start);
            if (endFrequency) {
                oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
            }
            volume.gain.setValueAtTime(0.0001, start);
            volume.gain.exponentialRampToValueAtTime(gain, start + 0.018);
            volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            oscillator.connect(volume);
            volume.connect(ctx.destination);
            oscillator.start(start);
            oscillator.stop(start + duration + 0.03);
        }

        function noise({ duration, gain = 0.08, delay = 0, filter = 900 }) {
            if (!window.AudioContext && !window.webkitAudioContext) return;
            const ctx = getContext();
            const start = ctx.currentTime + delay;
            const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * duration)), ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.5);
            }
            const source = ctx.createBufferSource();
            const band = ctx.createBiquadFilter();
            const volume = ctx.createGain();
            source.buffer = buffer;
            band.type = 'bandpass';
            band.frequency.setValueAtTime(filter, start);
            band.Q.setValueAtTime(0.8, start);
            volume.gain.setValueAtTime(gain, start);
            volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
            source.connect(band);
            band.connect(volume);
            volume.connect(ctx.destination);
            source.start(start);
            source.stop(start + duration);
        }

        return {
            draw() {
                tone({ frequency: 160, endFrequency: 90, duration: 0.48, type: 'triangle', gain: 0.08 });
                tone({ frequency: 420, endFrequency: 280, duration: 0.38, type: 'sine', gain: 0.035, delay: 0.08 });
            },
            release() {
                noise({ duration: 0.32, gain: 0.11, filter: 1700 });
                tone({ frequency: 720, endFrequency: 180, duration: 0.28, type: 'sawtooth', gain: 0.055 });
            },
            hit() {
                noise({ duration: 0.42, gain: 0.14, filter: 520 });
                tone({ frequency: 130, endFrequency: 60, duration: 0.36, type: 'square', gain: 0.08 });
                tone({ frequency: 880, endFrequency: 440, duration: 0.18, type: 'triangle', gain: 0.04, delay: 0.02 });
            }
        };
    }
}

function ensureArcheryLotteryStyles() {
    if (document.getElementById('archery-lottery-styles')) return;

    const style = document.createElement('style');
    style.id = 'archery-lottery-styles';
    style.textContent = `
        @keyframes archeryStageGlow {
            0%, 100% { opacity: 0.64; transform: translateX(-2%); }
            50% { opacity: 1; transform: translateX(2%); }
        }
        @keyframes eggEnter {
            from { opacity: 0; transform: translateY(24px) scale(0.86); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes eggFloat {
            0%, 100% { transform: translateY(0) rotate(-1deg); }
            50% { transform: translateY(-8px) rotate(1deg); }
        }
        @keyframes eggAim {
            0%, 100% { box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28), 0 0 0 0 rgba(213, 70, 54, 0.16); }
            50% { box-shadow: 0 16px 36px rgba(0, 0, 0, 0.34), 0 0 0 12px rgba(213, 70, 54, 0.26); }
        }
        @keyframes eggHit {
            0% { transform: scale(1) rotate(0); }
            35% { transform: scale(1.14) rotate(-5deg); }
            100% { transform: scale(1.05) rotate(2deg); }
        }
        @keyframes bowCharge {
            0%, 100% { filter: drop-shadow(0 0 16px rgba(246, 212, 142, 0.22)); }
            50% { filter: drop-shadow(0 0 30px rgba(245, 196, 95, 0.72)) drop-shadow(0 0 54px rgba(213, 70, 54, 0.28)); }
        }
        @keyframes bowRelease {
            0% { transform: translateY(-50%) scaleX(1); }
            35% { transform: translateY(-50%) scaleX(1.08); }
            100% { transform: translateY(-50%) scaleX(1); }
        }
        @keyframes chargePulse {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.45); }
            25% { opacity: 0.8; }
            100% { opacity: 0.18; transform: translate(-50%, -50%) scale(1.8); }
        }
        @keyframes chargeRelease {
            0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -50%) scale(2.6); }
        }
        @keyframes aimLinePulse {
            0%, 100% { opacity: 0.28; filter: drop-shadow(0 0 8px rgba(245, 196, 95, 0.44)); }
            50% { opacity: 0.9; filter: drop-shadow(0 0 18px rgba(245, 196, 95, 0.86)); }
        }
        @keyframes trailBurn {
            0% { opacity: 0.9; filter: blur(0) drop-shadow(0 0 16px rgba(245, 196, 95, 0.72)); }
            100% { opacity: 0; filter: blur(7px) drop-shadow(0 0 34px rgba(213, 70, 54, 0.52)); }
        }
        @keyframes arrowFletchFlash {
            0%, 100% { opacity: 1; transform: scaleX(1); }
            50% { opacity: 0.55; transform: scaleX(1.28); }
        }
        @keyframes sparkFly {
            from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            to { opacity: 0; transform: translate(calc(-50% + var(--spark-x)), calc(-50% + var(--spark-y))) scale(0.2); }
        }
        @keyframes finalPop {
            from { opacity: 0; transform: translateY(22px) scale(0.94); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .archery-lottery-stage {
            width: 100%;
            height: 100vh;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            padding: clamp(14px, 2.4vh, 24px) clamp(14px, 2.6vw, 32px);
            background:
                linear-gradient(180deg, rgba(17, 24, 39, 0.72), rgba(8, 13, 23, 0.92)),
                radial-gradient(circle at 22% 22%, rgba(191, 92, 58, 0.24), transparent 30%),
                radial-gradient(circle at 80% 18%, rgba(60, 139, 138, 0.24), transparent 32%),
                linear-gradient(140deg, #151c24 0%, #243026 50%, #151820 100%);
            color: #fff7e6;
            font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
        }
        .archery-lottery-stage::before {
            content: '';
            position: absolute;
            inset: 0;
            background:
                repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.045) 0 1px, transparent 1px 100px),
                linear-gradient(90deg, transparent, rgba(246, 212, 142, 0.12), transparent);
            animation: archeryStageGlow 5s ease-in-out infinite;
            pointer-events: none;
        }
        .archery-lottery-header {
            position: relative;
            z-index: 3;
            text-align: center;
            margin-bottom: clamp(10px, 1.8vh, 18px);
            flex: 0 0 auto;
        }
        .archery-lottery-title {
            font-size: clamp(28px, 4.6vw, 62px);
            font-weight: 900;
            letter-spacing: 0;
            text-shadow: 0 5px 24px rgba(0, 0, 0, 0.58), 0 0 30px rgba(246, 212, 142, 0.34);
        }
        .archery-lottery-subtitle {
            margin-top: 6px;
            font-size: clamp(14px, 1.7vw, 21px);
            color: rgba(255, 247, 230, 0.82);
        }
        .archery-lottery-field {
            width: min(1320px, 96vw);
            height: clamp(390px, 70vh, 630px);
            max-height: calc(100vh - 118px);
            position: relative;
            flex: 0 1 auto;
            z-index: 2;
            border: 1px solid rgba(246, 212, 142, 0.28);
            border-radius: 8px;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 34%),
                linear-gradient(90deg, rgba(50, 31, 23, 0.8) 0 18%, rgba(34, 58, 39, 0.74) 18% 100%);
            box-shadow: 0 34px 90px rgba(0, 0, 0, 0.42), inset 0 0 80px rgba(0, 0, 0, 0.25);
            overflow: hidden;
        }
        .archery-lottery-field::after {
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            bottom: 0;
            height: 30%;
            background: linear-gradient(180deg, transparent, rgba(23, 37, 29, 0.72));
            pointer-events: none;
        }
        .archery-bow {
            position: absolute;
            left: 3.2%;
            top: 50%;
            width: 92px;
            height: 238px;
            transform: translateY(-50%);
            z-index: 8;
        }
        .archery-bow.is-charging .archery-bow-arc {
            animation: bowCharge 0.64s ease-in-out infinite;
        }
        .archery-bow.is-releasing {
            animation: bowRelease 0.34s ease-out;
        }
        .archery-bow-arc {
            position: absolute;
            inset: 0 22px 0 0;
            border-right: 8px solid #c07c42;
            border-radius: 0 100% 100% 0;
            filter: drop-shadow(0 0 16px rgba(246, 212, 142, 0.22));
        }
        .archery-bow-string {
            position: absolute;
            top: 14px;
            bottom: 14px;
            right: 24px;
            width: 2px;
            background: rgba(255, 247, 230, 0.8);
            transform-origin: center;
            transition: transform 0.25s ease;
        }
        .archery-bow.is-drawn .archery-bow-string {
            transform: translateX(-38px);
            background: #fff7e6;
            box-shadow: 0 0 18px rgba(245, 196, 95, 0.76);
        }
        .archery-charge-ring {
            position: absolute;
            width: 78px;
            height: 78px;
            border: 2px solid rgba(245, 196, 95, 0.74);
            border-radius: 50%;
            opacity: 0;
            z-index: 6;
            pointer-events: none;
            box-shadow: 0 0 28px rgba(245, 196, 95, 0.42), inset 0 0 22px rgba(213, 70, 54, 0.18);
        }
        .archery-charge-ring::before,
        .archery-charge-ring::after {
            content: '';
            position: absolute;
            inset: 12px;
            border: 1px solid rgba(255, 247, 230, 0.54);
            border-radius: 50%;
        }
        .archery-charge-ring::after {
            inset: 22px;
            background: radial-gradient(circle, rgba(245, 196, 95, 0.52), transparent 62%);
        }
        .archery-charge-ring.is-charging {
            animation: chargePulse 0.78s ease-in-out infinite;
        }
        .archery-charge-ring.is-release {
            animation: chargeRelease 0.48s ease-out forwards;
        }
        .archery-aim-line {
            position: absolute;
            height: 2px;
            opacity: 0;
            z-index: 5;
            transform-origin: left center;
            pointer-events: none;
            background: repeating-linear-gradient(90deg, rgba(245, 196, 95, 0.95) 0 18px, transparent 18px 32px);
        }
        .archery-aim-line.is-visible {
            animation: aimLinePulse 0.34s ease-in-out infinite;
        }
        .archery-arrow-trail {
            position: absolute;
            height: 14px;
            opacity: 0;
            z-index: 8;
            transform-origin: left center;
            pointer-events: none;
            background: linear-gradient(90deg, rgba(213, 70, 54, 0.02), rgba(245, 196, 95, 0.82), rgba(255, 247, 230, 0.96));
            clip-path: polygon(0 50%, 78% 0, 100% 50%, 78% 100%);
        }
        .archery-arrow-trail.is-flying {
            animation: trailBurn 1.8s ease-out forwards;
        }
        .archery-arrow {
            position: absolute;
            left: 7%;
            top: 50%;
            width: 176px;
            height: 18px;
            opacity: 0;
            z-index: 9;
            pointer-events: none;
            transform-origin: left center;
            filter: drop-shadow(0 0 16px rgba(245, 196, 95, 0.55));
        }
        .archery-arrow-shaft {
            position: absolute;
            left: 14px;
            right: 28px;
            top: 8px;
            height: 3px;
            background: linear-gradient(90deg, #f7d68e, #8c4f2c);
            box-shadow: 0 0 12px rgba(246, 212, 142, 0.45);
        }
        .archery-arrow-head {
            position: absolute;
            right: 8px;
            top: 2px;
            width: 0;
            height: 0;
            border-top: 7px solid transparent;
            border-bottom: 7px solid transparent;
            border-left: 18px solid #e7e1d3;
            filter: drop-shadow(0 0 7px rgba(255, 247, 230, 0.62));
        }
        .archery-arrow-fletching {
            position: absolute;
            left: 0;
            top: 2px;
            width: 20px;
            height: 14px;
            background: linear-gradient(135deg, #d54636 0 50%, #fff7e6 50% 100%);
            clip-path: polygon(0 0, 100% 50%, 0 100%, 28% 50%);
            animation: arrowFletchFlash 0.28s ease-in-out infinite;
        }
        .archery-eggs-area {
            position: absolute;
            left: clamp(118px, 17%, 210px);
            right: 4%;
            top: 10%;
            bottom: 18%;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
            grid-auto-rows: minmax(100px, 1fr);
            align-items: center;
            justify-items: center;
            gap: 10px 12px;
            z-index: 4;
            overflow: visible;
        }
        .archery-egg {
            width: 88px;
            height: 112px;
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 18px 11px 14px;
            color: #3c2519;
            background:
                radial-gradient(circle at 33% 22%, rgba(255, 255, 255, 0.94), transparent 18%),
                radial-gradient(circle at 62% 70%, rgba(238, 188, 116, 0.34), transparent 36%),
                linear-gradient(150deg, #fff7e3 0%, #f1d8a6 74%, #d9a667 100%);
            border: 2px solid rgba(125, 75, 38, 0.38);
            border-radius: 52% 48% 50% 50% / 62% 62% 40% 40%;
            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28), inset -12px -16px 22px rgba(145, 86, 43, 0.14);
            opacity: 0;
            animation: eggEnter 0.48s ease forwards var(--egg-delay), eggFloat 3.8s ease-in-out infinite calc(var(--egg-delay) + 0.5s);
            transition: filter 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
        }
        .archery-egg-name {
            max-width: 70px;
            line-height: 1.08;
            font-weight: 900;
            text-align: center;
            overflow-wrap: anywhere;
            text-shadow: 0 1px 0 rgba(255, 255, 255, 0.52);
            position: relative;
            z-index: 2;
        }
        .archery-egg-shine {
            position: absolute;
            width: 18px;
            height: 34px;
            left: 19px;
            top: 19px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.45);
            transform: rotate(30deg);
        }
        .archery-egg.is-aimed {
            filter: brightness(1.12);
            animation: eggAim 0.45s ease-in-out infinite;
        }
        .archery-egg.is-target {
            opacity: 1 !important;
            z-index: 12;
            transform: translateY(0) scale(1.06);
        }
        .archery-egg.is-hit {
            animation: eggHit 0.5s ease forwards;
        }
        .archery-egg.is-winner {
            background:
                radial-gradient(circle at 33% 22%, rgba(255, 255, 255, 0.96), transparent 18%),
                radial-gradient(circle at 62% 70%, rgba(220, 53, 40, 0.2), transparent 34%),
                linear-gradient(150deg, #fff0c6 0%, #f5c45f 72%, #d54636 100%);
            border-color: rgba(255, 247, 230, 0.88);
            box-shadow: 0 18px 46px rgba(0, 0, 0, 0.42), 0 0 32px rgba(245, 196, 95, 0.48);
        }
        .archery-egg.is-cracked::before,
        .archery-egg.is-cracked::after {
            content: '';
            position: absolute;
            z-index: 3;
            background: rgba(74, 39, 23, 0.78);
            transform-origin: center;
            clip-path: polygon(42% 0, 58% 0, 52% 34%, 68% 34%, 46% 100%, 51% 48%, 34% 48%);
        }
        .archery-egg.is-cracked::before {
            width: 24px;
            height: 78px;
            top: 22px;
            left: 45px;
            transform: rotate(-8deg);
        }
        .archery-egg.is-cracked::after {
            width: 18px;
            height: 52px;
            top: 38px;
            left: 57px;
            transform: rotate(24deg);
            opacity: 0.7;
        }
        .archery-result-panel {
            position: absolute;
            left: 24px;
            bottom: 22px;
            right: 24px;
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            z-index: 7;
        }
        .archery-result-chip {
            display: flex;
            align-items: baseline;
            gap: 10px;
            padding: 10px 14px;
            border: 1px solid rgba(246, 212, 142, 0.4);
            border-radius: 8px;
            background: rgba(18, 22, 26, 0.78);
            color: #fff7e6;
            box-shadow: 0 12px 24px rgba(0, 0, 0, 0.28);
        }
        .archery-result-prize {
            color: #f5c45f;
            font-size: 14px;
        }
        .archery-result-chip strong {
            font-size: 20px;
        }
        .archery-impact-burst {
            position: absolute;
            width: 1px;
            height: 1px;
            z-index: 10;
            pointer-events: none;
        }
        .archery-impact-burst span {
            position: absolute;
            left: 0;
            top: 0;
            width: 11px;
            height: 11px;
            border-radius: 50%;
            background: radial-gradient(circle, #fff7e6, #f5c45f 58%, rgba(213, 70, 54, 0.8));
            box-shadow: 0 0 18px #f5c45f, 0 0 34px rgba(213, 70, 54, 0.62);
            animation: sparkFly 1.05s ease-out forwards;
        }
        .archery-final-list {
            position: absolute;
            inset: 0;
            z-index: 11;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-wrap: wrap;
            gap: 18px;
            padding: 44px;
            background: rgba(9, 13, 20, 0.84);
            backdrop-filter: blur(4px);
        }
        .archery-final-card {
            width: 280px;
            height: 178px;
            box-sizing: border-box;
            padding: 22px 24px;
            border: 1px solid rgba(246, 212, 142, 0.66);
            border-radius: 8px;
            background: linear-gradient(160deg, rgba(255, 247, 230, 0.16), rgba(20, 31, 30, 0.94));
            color: #fff7e6;
            text-align: center;
            box-shadow: 0 22px 60px rgba(0, 0, 0, 0.45), 0 0 28px rgba(245, 196, 95, 0.22);
            opacity: 0;
            animation: finalPop 0.62s ease forwards var(--final-delay);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
        }
        .archery-final-card span {
            display: block;
            width: 100%;
            margin-bottom: 14px;
            color: #f5c45f;
            font-size: 20px;
            font-weight: 700;
            line-height: 1.15;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .archery-final-card strong {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 82px;
            line-height: 1.05;
            overflow-wrap: anywhere;
            word-break: break-word;
            overflow: hidden;
        }
        .archery-lottery-field.showing-final .archery-eggs-area,
        .archery-lottery-field.showing-final .archery-bow,
        .archery-lottery-field.showing-final .archery-result-panel {
            opacity: 0.18;
        }
        @media (max-width: 760px) {
            .archery-lottery-stage {
                padding: 12px 8px;
                justify-content: center;
            }
            .archery-lottery-field {
                width: 96vw;
                height: calc(100vh - 108px);
                min-height: 0;
                max-height: 560px;
            }
            .archery-bow {
                left: 2px;
                width: 58px;
                height: 166px;
            }
            .archery-bow-string {
                top: 10px;
                bottom: 10px;
                right: 14px;
            }
            .archery-bow.is-drawn .archery-bow-string {
                transform: translateX(-20px);
            }
            .archery-eggs-area {
                left: 72px;
                right: 8px;
                top: 8%;
                bottom: 20%;
                grid-template-columns: repeat(auto-fit, minmax(68px, 1fr));
                grid-auto-rows: minmax(78px, 1fr);
                gap: 7px;
            }
            .archery-egg {
                width: 60px;
                height: 78px;
                padding: 12px 7px 9px;
            }
            .archery-egg-name {
                max-width: 50px;
                font-size: 10px !important;
            }
            .archery-arrow {
                width: 112px;
            }
            .archery-result-panel {
                left: 12px;
                right: 12px;
                bottom: 12px;
            }
            .archery-final-list {
                padding: 22px;
                align-content: center;
            }
            .archery-final-card {
                width: min(250px, 84vw);
                height: 150px;
                padding: 18px 20px;
            }
            .archery-final-card span {
                font-size: 17px;
            }
            .archery-final-card strong {
                height: 70px;
            }
        }
    `;
    document.head.appendChild(style);
}

// 显示抽奖动画 - 霓虹灯轮盘
function showLotteryAnimation(allPlayers, winners, prizes, onComplete) {
    const container = document.getElementById('lottery-animation-container');
    container.style.display = 'flex';
    container.innerHTML = '';
    renderArcheryEggLotteryAnimation(container, allPlayers, winners, prizes, onComplete);
    return;

    const stagePalette = {
        ink: '#07111f',
        deep: '#102236',
        jade: '#7fd6c2',
        amber: '#d6a64f',
        coral: '#d66f5f',
        pearl: '#f7f1df'
    };

    // 创建主容器
    const animBox = document.createElement('div');
    animBox.style.cssText = `
        width: 100%;
        height: 100vh;
        background:
            linear-gradient(120deg, rgba(127, 214, 194, 0.12), transparent 28%, rgba(214, 166, 79, 0.14) 72%, transparent),
            radial-gradient(circle at 18% 20%, rgba(214, 111, 95, 0.2), transparent 26%),
            radial-gradient(circle at 78% 16%, rgba(127, 214, 194, 0.18), transparent 30%),
            linear-gradient(180deg, #07111f 0%, #102236 48%, #050811 100%);
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    `;
    container.appendChild(animBox);

    // 添加动态背景粒子
    createParticleBackground(animBox);

    // 添加动画样式
    const style = document.createElement('style');
    style.textContent = `
        @keyframes neonPulse {
            0%, 100% {
                text-shadow: 0 0 18px rgba(247, 241, 223, 0.45), 0 0 42px rgba(127, 214, 194, 0.32);
            }
            50% {
                text-shadow: 0 0 26px rgba(247, 241, 223, 0.72), 0 0 58px rgba(214, 166, 79, 0.42);
            }
        }
        @keyframes slotSpin {
            0% { transform: translateY(0); }
            100% { transform: translateY(-100%); }
        }
        @keyframes winnerGlow {
            0%, 100% {
                box-shadow: 0 0 36px rgba(214, 166, 79, 0.62), 0 0 80px rgba(127, 214, 194, 0.34), inset 0 0 42px rgba(214, 166, 79, 0.18);
                transform: scale(1);
            }
            50% {
                box-shadow: 0 0 58px rgba(214, 166, 79, 0.82), 0 0 110px rgba(127, 214, 194, 0.48), inset 0 0 52px rgba(247, 241, 223, 0.2);
                transform: scale(1.035);
            }
        }
        @keyframes shimmer {
            0% { background-position: -1000px 0; }
            100% { background-position: 1000px 0; }
        }
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-35px); }
        }
        @keyframes float {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            50% { transform: translateY(-28px) rotate(12deg); }
        }
        @keyframes stageLine {
            0% { transform: translateX(-20%); opacity: 0.2; }
            50% { opacity: 0.58; }
            100% { transform: translateX(20%); opacity: 0.2; }
        }
    `;
    document.head.appendChild(style);

    const stageLine = document.createElement('div');
    stageLine.style.cssText = `
        position: absolute;
        width: 140%;
        height: 1px;
        top: 22%;
        left: -20%;
        background: linear-gradient(90deg, transparent, rgba(247, 241, 223, 0.42), transparent);
        animation: stageLine 7s ease-in-out infinite;
        z-index: 1;
    `;
    animBox.appendChild(stageLine);

    // 主标题
    const title = document.createElement('div');
    title.style.cssText = `
        color: ${stagePalette.pearl};
        font-size: clamp(48px, 7vw, 88px);
        font-weight: 800;
        text-shadow: 0 0 18px rgba(247, 241, 223, 0.45), 0 0 42px rgba(127, 214, 194, 0.32);
        margin-bottom: 16px;
        letter-spacing: 10px;
        z-index: 10;
        animation: neonPulse 2s ease-in-out infinite;
        font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
        text-transform: uppercase;
    `;
    title.textContent = '加州大乐透';
    animBox.appendChild(title);

    // 副标题（日期）
    const subtitle = document.createElement('div');
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    subtitle.style.cssText = `
        color: rgba(247, 241, 223, 0.82);
        font-size: clamp(18px, 2.4vw, 30px);
        font-weight: 500;
        text-shadow: 0 0 18px rgba(214, 166, 79, 0.24);
        margin-bottom: 56px;
        letter-spacing: 5px;
        z-index: 10;
    `;
    subtitle.textContent = dateStr;
    animBox.appendChild(subtitle);

    // 主显示区域
    const displayArea = document.createElement('div');
    displayArea.style.cssText = `
        display: flex;
        gap: ${winners.length === 1 ? '0' : winners.length <= 3 ? '70px' : '50px'}px;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        z-index: 10;
        padding: 0 40px;
        max-width: 1480px;
    `;
    animBox.appendChild(displayArea);

    // 为每个奖品创建老虎机轮盘
    const slots = [];
    winners.forEach((winner, index) => {
        const slotWrapper = document.createElement('div');
        slotWrapper.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 25px;
        `;

        // 奖品标签（顶部霓虹灯效果）
        const prizeLabel = document.createElement('div');
        prizeLabel.style.cssText = `
            background: linear-gradient(135deg, rgba(247, 241, 223, 0.96), rgba(214, 166, 79, 0.94));
            background-size: 200% 100%;
            color: #102236;
            padding: 14px 34px;
            border: 1px solid rgba(247, 241, 223, 0.72);
            border-radius: 8px;
            font-size: ${winners.length === 1 ? '38px' : winners.length <= 3 ? '30px' : '24px'}px;
            font-weight: 800;
            box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28), 0 0 34px rgba(214, 166, 79, 0.32);
            text-align: center;
            min-width: 200px;
            animation: shimmer 3s linear infinite;
            letter-spacing: 1px;
        `;
        prizeLabel.textContent = prizes[index] || `奖品${index + 1}`;
        slotWrapper.appendChild(prizeLabel);

        // 老虎机轮盘容器
        const slotMachine = document.createElement('div');
        const slotWidth = winners.length === 1 ? 280 : winners.length <= 3 ? 240 : 200;
        const slotHeight = winners.length === 1 ? 420 : winners.length <= 3 ? 360 : 290;
        slotMachine.style.cssText = `
            width: ${slotWidth}px;
            height: ${slotHeight}px;
            background:
                linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 28%),
                linear-gradient(135deg, rgba(12, 26, 43, 0.92) 0%, rgba(7, 17, 31, 0.98) 100%);
            border: 1px solid rgba(247, 241, 223, 0.28);
            border-radius: 8px;
            overflow: hidden;
            position: relative;
            box-shadow:
                0 30px 70px rgba(0, 0, 0, 0.42),
                0 0 42px rgba(127, 214, 194, 0.18),
                inset 0 0 70px rgba(0, 0, 0, 0.6);
        `;

        // 中间高亮框（霓虹灯边框）
        const highlightFrame = document.createElement('div');
        const itemHeight = winners.length === 1 ? 130 : winners.length <= 3 ? 110 : 88;
        highlightFrame.style.cssText = `
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 92%;
            height: ${itemHeight}px;
            border: 1px solid rgba(214, 166, 79, 0.86);
            border-radius: 6px;
            background: rgba(214, 166, 79, 0.08);
            box-shadow:
                0 0 28px rgba(214, 166, 79, 0.48),
                inset 0 0 24px rgba(247, 241, 223, 0.12);
            pointer-events: none;
            z-index: 3;
        `;
        slotMachine.appendChild(highlightFrame);

        // 滚动内容容器
        const scrollContainer = document.createElement('div');
        scrollContainer.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            overflow: hidden;
        `;

        // 滚动列表
        const scrollList = document.createElement('div');
        scrollList.style.cssText = `
            position: absolute;
            width: 100%;
            display: flex;
            flex-direction: column;
        `;

        // 为每个轮盘创建随机打乱的玩家列表
        const shuffledPlayers = [...allPlayers].sort(() => Math.random() - 0.5);

        // 创建足够多的名字用于滚动（5倍）
        const repeatedPlayers = [];
        for (let i = 0; i < 5; i++) {
            repeatedPlayers.push(...shuffledPlayers);
        }

        repeatedPlayers.forEach((name) => {
            const nameItem = document.createElement('div');
            nameItem.style.cssText = `
                height: ${itemHeight}px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: ${winners.length === 1 ? '130px' : winners.length <= 3 ? '110px' : '88px'}px;
                font-weight: 900;
                color: ${stagePalette.pearl};
                text-shadow: 0 0 20px rgba(127, 214, 194, 0.34), 0 4px 16px rgba(0, 0, 0, 0.56);
                font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                padding: 0 16px;
            `;
            nameItem.textContent = name;
            scrollList.appendChild(nameItem);
        });

        scrollContainer.appendChild(scrollList);
        slotMachine.appendChild(scrollContainer);

        // 上下渐变遮罩
        const maskTop = document.createElement('div');
        maskTop.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 150px;
            background: linear-gradient(to bottom, rgba(7, 17, 31, 1) 0%, rgba(7, 17, 31, 0.72) 42%, transparent 100%);
            pointer-events: none;
            z-index: 2;
        `;
        slotMachine.appendChild(maskTop);

        const maskBottom = document.createElement('div');
        maskBottom.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            height: 150px;
            background: linear-gradient(to top, rgba(7, 17, 31, 1) 0%, rgba(7, 17, 31, 0.72) 42%, transparent 100%);
            pointer-events: none;
            z-index: 2;
        `;
        slotMachine.appendChild(maskBottom);

        slotWrapper.appendChild(slotMachine);
        displayArea.appendChild(slotWrapper);

        // 计算目标位置 - 找到中奖者在打乱后列表中的位置
        const targetIndex = shuffledPlayers.indexOf(winner) + shuffledPlayers.length * 2; // 中间段
        const targetOffset = -(targetIndex * itemHeight - slotHeight / 2 + itemHeight / 2);

        slots.push({
            scrollList,
            itemHeight,
            targetOffset,
            winner,
            prizeLabel,
            slotMachine,
            highlightFrame,
            currentOffset: 0,
            velocity: 0
        });
    });

    // 动画逻辑 - 10秒
    const totalDuration = 10000;
    const startTime = Date.now();

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / totalDuration, 1);

        // 缓动函数：快速开始，逐渐减速到精确停止
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);

        slots.forEach((slot) => {
            // 使用缓动函数从初始位置平滑过渡到目标位置
            const startOffset = 0;
            slot.currentOffset = startOffset + (slot.targetOffset - startOffset) * easeOutQuart;
            slot.scrollList.style.transform = `translateY(${slot.currentOffset}px)`;
        });

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // 动画结束，立即显示中奖效果
            showWinnerEffect();
        }
    }

    function showWinnerEffect() {
        // 更新标题
        title.textContent = '恭喜中奖';
        title.style.fontSize = 'clamp(54px, 7.2vw, 96px)';
        subtitle.style.display = 'none';

        // 所有轮盘变金色霓虹灯
        slots.forEach(slot => {
            slot.slotMachine.style.borderColor = 'rgba(214, 166, 79, 0.95)';
            slot.slotMachine.style.animation = 'winnerGlow 1.5s ease-in-out infinite';
            slot.highlightFrame.style.borderColor = 'rgba(247, 241, 223, 0.96)';
            slot.highlightFrame.style.boxShadow = '0 0 40px rgba(214, 166, 79, 0.72), inset 0 0 34px rgba(247, 241, 223, 0.24)';
            slot.prizeLabel.style.animation = 'bounce 1s ease-in-out infinite';
        });

        createFireworks(animBox);
        createLightBurst(animBox);

        setTimeout(() => {
            showFinalResults();
        }, 3000);
    }

    function createParticleBackground(parent) {
        const colors = ['rgba(247, 241, 223, 0.86)', 'rgba(127, 214, 194, 0.74)', 'rgba(214, 166, 79, 0.78)', 'rgba(214, 111, 95, 0.5)'];
        for (let i = 0; i < 86; i++) {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position: absolute;
                width: ${2 + Math.random() * 4}px;
                height: ${2 + Math.random() * 4}px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                border-radius: 50%;
                top: ${Math.random() * 100}%;
                left: ${Math.random() * 100}%;
                opacity: ${0.22 + Math.random() * 0.45};
                box-shadow: 0 0 10px currentColor;
                animation: float ${5 + Math.random() * 10}s ease-in-out infinite;
                animation-delay: ${Math.random() * 5}s;
            `;
            parent.appendChild(particle);
        }
    }

    function showFinalResults() {
        displayArea.innerHTML = '';
        title.textContent = '中奖名单';

        const resultsContainer = document.createElement('div');
        resultsContainer.style.cssText = `
            display: flex;
            gap: 60px;
            flex-wrap: wrap;
            justify-content: center;
            align-items: center;
        `;

        winners.forEach((winner, i) => {
            const resultCard = document.createElement('div');
            resultCard.style.cssText = `
                background:
                    linear-gradient(180deg, rgba(255, 255, 255, 0.1), transparent 30%),
                    linear-gradient(135deg, rgba(16, 34, 54, 0.92), rgba(7, 17, 31, 0.96));
                border: 1px solid rgba(214, 166, 79, 0.82);
                border-radius: 8px;
                padding: ${winners.length === 1 ? '90px 110px' : winners.length <= 3 ? '70px 90px' : '50px 70px'};
                text-align: center;
                box-shadow: 0 35px 90px rgba(0, 0, 0, 0.48), 0 0 58px rgba(214, 166, 79, 0.34);
                opacity: 0;
                transform: translateY(30px) scale(0.92);
                position: relative;
                overflow: hidden;
            `;

            // 闪光效果
            const shine = document.createElement('div');
            shine.style.cssText = `
                position: absolute;
                top: -50%;
                left: -100%;
                width: 50%;
                height: 200%;
                background: linear-gradient(90deg, transparent, rgba(247, 241, 223, 0.35), transparent);
                transform: skewX(-20deg);
                animation: shimmer 2s infinite;
            `;
            resultCard.appendChild(shine);

            // 奖品名称
            const prizeText = document.createElement('div');
            prizeText.style.cssText = `
                font-size: ${winners.length === 1 ? '42px' : winners.length <= 3 ? '32px' : '26px'}px;
                font-weight: 700;
                color: ${stagePalette.jade};
                text-shadow: 0 0 22px rgba(127, 214, 194, 0.32);
                margin-bottom: 25px;
                position: relative;
                z-index: 1;
                letter-spacing: 2px;
            `;
            prizeText.textContent = prizes[i] || `奖品${i + 1}`;
            resultCard.appendChild(prizeText);

            // 中奖者名字
            const winnerText = document.createElement('div');
            winnerText.style.cssText = `
                font-size: ${winners.length === 1 ? '160px' : winners.length <= 3 ? '115px' : '85px'}px;
                font-weight: 900;
                color: ${stagePalette.pearl};
                text-shadow: 0 0 30px rgba(214, 166, 79, 0.45), 0 5px 20px rgba(0, 0, 0, 0.5);
                position: relative;
                z-index: 1;
                font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
            `;
            winnerText.textContent = winner;
            resultCard.appendChild(winnerText);

            resultsContainer.appendChild(resultCard);

            // 逐个弹出动画
            setTimeout(() => {
                resultCard.style.transition = 'all 0.9s cubic-bezier(0.2, 0.9, 0.2, 1)';
                resultCard.style.opacity = '1';
                resultCard.style.transform = 'translateY(0) scale(1)';
            }, i * 500);
        });

        displayArea.appendChild(resultsContainer);

        // 4秒后关闭
        setTimeout(() => {
            container.style.display = 'none';
            onComplete();
        }, 5000);
    }

    function createFireworks(parent) {
        const sparks = ['#f7f1df', '#d6a64f', '#7fd6c2', '#d66f5f'];
        for (let i = 0; i < 70; i++) {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position: absolute;
                width: ${8 + Math.random() * 8}px;
                height: ${8 + Math.random() * 8}px;
                background: ${sparks[Math.floor(Math.random() * sparks.length)]};
                border-radius: 50%;
                top: 50%;
                left: 50%;
                pointer-events: none;
                box-shadow: 0 0 20px currentColor, 0 0 40px currentColor;
            `;
            parent.appendChild(particle);

            const angle = (Math.PI * 2 * i) / 80;
            const velocity = 12 + Math.random() * 25;
            const vx = Math.cos(angle) * velocity;
            const vy = Math.sin(angle) * velocity;

            let x = 0, y = 0;
            let opacity = 1;
            let scale = 1;

            function animateParticle() {
                x += vx;
                y += vy + 0.6;
                opacity -= 0.012;
                scale -= 0.012;

                particle.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
                particle.style.opacity = opacity;

                if (opacity > 0) {
                    requestAnimationFrame(animateParticle);
                } else {
                    particle.remove();
                }
            }
            animateParticle();
        }
    }

    function createLightBurst(parent) {
        for (let i = 0; i < 14; i++) {
            const beam = document.createElement('div');
            beam.style.cssText = `
                position: absolute;
                width: 4px;
                height: 500px;
                background: linear-gradient(to bottom,
                    ${i % 2 === 0 ? 'rgba(214, 166, 79, 0.84)' : 'rgba(127, 214, 194, 0.72)'},
                    transparent);
                top: 50%;
                left: 50%;
                transform-origin: top center;
                transform: translate(-50%, -50%) rotate(${i * 25.7}deg);
                pointer-events: none;
                opacity: 1;
                box-shadow: 0 0 20px currentColor;
            `;
            parent.appendChild(beam);

            let opacity = 1;
            function animateBeam() {
                opacity -= 0.015;
                beam.style.opacity = opacity;
                if (opacity > 0) {
                    requestAnimationFrame(animateBeam);
                } else {
                    beam.remove();
                }
            }
            animateBeam();
        }
    }

    // 启动动画
    animate();
}

// 抽奖功能事件监听
function setupLotteryEventListeners() {
    const createBtn = document.getElementById('create-lottery-btn');
    if (createBtn) {
        createBtn.addEventListener('click', () => openLotteryModal());
    }

    const lotteryForm = document.getElementById('lottery-form');
    if (lotteryForm) {
        lotteryForm.addEventListener('submit', handleLotterySubmit);
    }

    const winnerCountSelect = document.getElementById('lottery-winner-count');
    if (winnerCountSelect) {
        winnerCountSelect.addEventListener('change', (e) => {
            updatePrizesInputs(parseInt(e.target.value));
        });
    }

    const searchInput = document.getElementById('lottery-player-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderLotteryPlayerList(e.target.value.trim());
        });
    }

    // 关���按钮
    const closeBtn = document.querySelector('#lottery-modal .close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeLotteryModal);
    }
}
