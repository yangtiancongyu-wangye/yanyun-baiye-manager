// 数据存储
let players = [];
let teams = {};
let lotteries = [];
let currentBattleDate = new Date().toISOString().split('T')[0];

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

// 保存玩家数据到服务器
async function savePlayers() {
    try {
        await fetch('/api/players', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(players)
        });
    } catch (error) {
        console.error('保存玩家数据失败:', error);
    }
}

// 保存配队数据到服务器
async function saveTeams() {
    try {
        await fetch('/api/teams', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(teams)
        });
    } catch (error) {
        console.error('保存配队数据失败:', error);
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    await loadDataFromServer();
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

function handlePlayerSubmit(e) {
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
            syncPlayerIdToLotteries(oldId, player.id);
        }
    } else {
        // 新增时生成uid（服务端会兜底，前端也生成以确保本地一致性）
        player.uid = 'u' + Math.random().toString(36).substring(2, 11);
        players.push(player);
    }

    savePlayers();
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
function syncPlayerIdToLotteries(oldId, newId) {
    let changed = false;
    lotteries.forEach(lottery => {
        if (lottery.playerIds) {
            const idx = lottery.playerIds.indexOf(oldId);
            if (idx !== -1) {
                lottery.playerIds[idx] = newId;
                changed = true;
            }
        }
    });
    if (changed) saveLotteries();
}

function deletePlayer(index) {
    if (confirm('确定删除该玩家吗？')) {
        players.splice(index, 1);
        savePlayers();
        renderTalentTable();
    }
}

function savePlayers() {
    fetch('/api/players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(players)
    }).catch(error => console.error('保存玩家数据失败:', error));
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

        savePlayers();
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
async function processRegistrationImage(file) {
    showLoading('正在识别报名玩家...');
    closeImportRegistrationModal();

    try {
        // 准备人才库玩家列表
        const playersList = players.map(p => p.id);

        // 使用FormData上传原始文件
        const formData = new FormData();
        formData.append('image', file);
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

function saveTeams() {
    fetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teams)
    }).catch(error => console.error('保存配队数据失败:', error));
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
        await fetch('/api/lotteries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lotteries)
        });
    } catch (error) {
        console.error('保存抽奖数据失败:', error);
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

        // 填充玩家
        lottery.playerIds.forEach(id => selectedLotteryPlayers.add(id));

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
                selectedLotteryPlayers.add(player.id);
            } else {
                selectedLotteryPlayers.delete(player.id);
            }
            updateLotterySelectedPreview();
        };

        // 点击checkbox本身也更新状态
        checkbox.onclick = (e) => {
            e.stopPropagation();

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
        tag.style.cssText = `
            display: inline-block;
            padding: 4px 8px;
            background: #007bff;
            color: white;
            border-radius: 4px;
            font-size: 12px;
        `;
        tag.textContent = playerId;
        tagsContainer.appendChild(tag);
    });

    countEl.textContent = `当前已添加${selectedLotteryPlayers.size}名玩家`;
}

// 提交抽奖表单
function handleLotterySubmit(e) {
    e.preventDefault();

    const name = document.getElementById('lottery-name').value.trim();
    const winnerCount = parseInt(document.getElementById('lottery-winner-count').value);
    const prizeInputs = document.querySelectorAll('.lottery-prize-input');
    const prizes = Array.from(prizeInputs).map(input => input.value.trim());

    // 验证
    if (!name) {
        alert('请补充信息');
        return;
    }

    if (prizes.some(p => !p)) {
        alert('请补充信息');
        return;
    }

    if (selectedLotteryPlayers.size === 0) {
        alert('请补充信息');
        return;
    }

    if (selectedLotteryPlayers.size < winnerCount) {
        alert('玩家名单数不能少于可中奖人数');
        return;
    }

    const lotteryData = {
        id: currentEditingLotteryIndex !== null ? lotteries[currentEditingLotteryIndex].id : Date.now(),
        name,
        winnerCount,
        prizes,
        playerIds: Array.from(selectedLotteryPlayers),
        createTime: currentEditingLotteryIndex !== null ? lotteries[currentEditingLotteryIndex].createTime : new Date().toISOString(),
        winners: currentEditingLotteryIndex !== null ? lotteries[currentEditingLotteryIndex].winners : null
    };

    if (currentEditingLotteryIndex !== null) {
        lotteries[currentEditingLotteryIndex] = lotteryData;
    } else {
        lotteries.push(lotteryData);
    }

    saveLotteries();
    renderLotteryTable();
    closeLotteryModal();
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
function deleteLottery(index) {
    if (confirm('确定删除该抽奖记录吗？')) {
        lotteries.splice(index, 1);
        saveLotteries();
        renderLotteryTable();
    }
}

// 执行抽奖
function drawLottery(index) {
    const lottery = lotteries[index];

    if (confirm(`确定要为"${lottery.name}"进行抽奖吗？抽奖后将无法修改。`)) {
        // 计算中奖玩家（考虑历史中奖记录）
        const winners = calculateWinnersWithHistory(lottery.playerIds, lottery.winnerCount);

        // 显示抽奖动画
        showLotteryAnimation(lottery.playerIds, winners, lottery.prizes, () => {
            // 动画结束后保存结果
            lottery.winners = winners;
            saveLotteries();
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

// 显示抽奖动画 - 霓虹灯轮盘
function showLotteryAnimation(allPlayers, winners, prizes, onComplete) {
    const container = document.getElementById('lottery-animation-container');
    container.style.display = 'flex';
    container.innerHTML = '';

    // 创建主容器
    const animBox = document.createElement('div');
    animBox.style.cssText = `
        width: 100%;
        height: 100vh;
        background: radial-gradient(ellipse at center, #2d0a4e 0%, #0a0015 50%, #000000 100%);
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
                text-shadow: 0 0 15px #fff, 0 0 30px #fff, 0 0 45px #ff00de, 0 0 60px #ff00de, 0 0 75px #ff00de;
            }
            50% {
                text-shadow: 0 0 25px #fff, 0 0 40px #ff00de, 0 0 55px #ff00de, 0 0 70px #ff00de, 0 0 85px #ff00de, 0 0 100px #ff00de;
            }
        }
        @keyframes slotSpin {
            0% { transform: translateY(0); }
            100% { transform: translateY(-100%); }
        }
        @keyframes winnerGlow {
            0%, 100% {
                box-shadow: 0 0 40px rgba(255, 0, 222, 0.9), 0 0 80px rgba(0, 255, 255, 0.7), 0 0 120px rgba(255, 215, 0, 0.5);
                transform: scale(1);
            }
            50% {
                box-shadow: 0 0 60px rgba(255, 0, 222, 1), 0 0 120px rgba(0, 255, 255, 0.9), 0 0 180px rgba(255, 215, 0, 0.7);
                transform: scale(1.08);
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
            50% { transform: translateY(-20px) rotate(180deg); }
        }
    `;
    document.head.appendChild(style);

    // 主标题
    const title = document.createElement('div');
    title.style.cssText = `
        color: #fff;
        font-size: 88px;
        font-weight: 900;
        text-shadow: 0 0 15px #fff, 0 0 30px #fff, 0 0 45px #ff00de, 0 0 60px #ff00de, 0 0 75px #ff00de;
        margin-bottom: 25px;
        letter-spacing: 20px;
        z-index: 10;
        animation: neonPulse 2s ease-in-out infinite;
        font-family: 'Arial Black', sans-serif;
    `;
    title.textContent = '加州大乐透';
    animBox.appendChild(title);

    // 副标题（日期）
    const subtitle = document.createElement('div');
    const today = new Date();
    const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
    subtitle.style.cssText = `
        color: #00ffff;
        font-size: 38px;
        font-weight: 600;
        text-shadow: 0 0 15px #00ffff, 0 0 30px #00ffff, 0 0 45px #00ffff;
        margin-bottom: 80px;
        letter-spacing: 8px;
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
            background: linear-gradient(90deg, #ff00de, #00ffff, #ff00de);
            background-size: 200% 100%;
            color: #000;
            padding: 18px 40px;
            border-radius: 30px;
            font-size: ${winners.length === 1 ? '38px' : winners.length <= 3 ? '30px' : '24px'}px;
            font-weight: 900;
            box-shadow: 0 0 25px rgba(255, 0, 222, 0.9), 0 0 50px rgba(0, 255, 255, 0.7), 0 5px 15px rgba(0, 0, 0, 0.5);
            text-align: center;
            min-width: 200px;
            animation: shimmer 3s linear infinite;
            letter-spacing: 2px;
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
            background: linear-gradient(135deg, rgba(10, 0, 30, 0.95) 0%, rgba(30, 0, 60, 0.98) 100%);
            border: 6px solid #ff00de;
            border-radius: 35px;
            overflow: hidden;
            position: relative;
            box-shadow:
                0 0 40px rgba(255, 0, 222, 0.7),
                0 0 80px rgba(0, 255, 255, 0.5),
                inset 0 0 60px rgba(0, 0, 0, 0.9);
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
            border: 5px solid #00ffff;
            border-radius: 18px;
            box-shadow:
                0 0 25px #00ffff,
                0 0 50px rgba(0, 255, 255, 0.5),
                inset 0 0 25px rgba(0, 255, 255, 0.3);
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
                color: #fff;
                text-shadow: 0 0 20px #ff00de, 0 0 40px #00ffff, 0 0 60px rgba(255, 0, 222, 0.5);
                font-family: 'Arial Black', sans-serif;
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
            background: linear-gradient(to bottom, rgba(0, 0, 0, 1) 0%, transparent 100%);
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
            background: linear-gradient(to top, rgba(0, 0, 0, 1) 0%, transparent 100%);
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
        title.textContent = '🎉 恭喜中奖 🎉';
        title.style.fontSize = '96px';
        subtitle.style.display = 'none';

        // 所有轮盘变金色霓虹灯
        slots.forEach(slot => {
            slot.slotMachine.style.borderColor = '#ffd700';
            slot.slotMachine.style.animation = 'winnerGlow 1.5s ease-in-out infinite';
            slot.highlightFrame.style.borderColor = '#ffd700';
            slot.highlightFrame.style.boxShadow = '0 0 40px #ffd700, 0 0 80px rgba(255, 215, 0, 0.6), inset 0 0 40px rgba(255, 215, 0, 0.5)';
            slot.prizeLabel.style.animation = 'bounce 1s ease-in-out infinite';
        });

        createFireworks(animBox);
        createLightBurst(animBox);

        setTimeout(() => {
            showFinalResults();
        }, 3000);
    }

    function createParticleBackground(parent) {
        for (let i = 0; i < 120; i++) {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position: absolute;
                width: ${3 + Math.random() * 6}px;
                height: ${3 + Math.random() * 6}px;
                background: ${Math.random() > 0.5 ? '#ff00de' : '#00ffff'};
                border-radius: 50%;
                top: ${Math.random() * 100}%;
                left: ${Math.random() * 100}%;
                opacity: ${0.3 + Math.random() * 0.6};
                box-shadow: 0 0 10px currentColor;
                animation: float ${5 + Math.random() * 10}s ease-in-out infinite;
                animation-delay: ${Math.random() * 5}s;
            `;
            parent.appendChild(particle);
        }
    }

    function showFinalResults() {
        displayArea.innerHTML = '';
        title.textContent = '🎉 中奖名单 🎉';

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
                background: linear-gradient(135deg, rgba(255, 0, 222, 0.35) 0%, rgba(0, 255, 255, 0.35) 100%);
                border: 8px solid #ffd700;
                border-radius: 40px;
                padding: ${winners.length === 1 ? '90px 110px' : winners.length <= 3 ? '70px 90px' : '50px 70px'};
                text-align: center;
                box-shadow: 0 0 60px rgba(255, 215, 0, 1), 0 0 120px rgba(255, 0, 222, 0.7), 0 10px 30px rgba(0, 0, 0, 0.5);
                opacity: 0;
                transform: scale(0.3) rotateZ(-180deg);
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
                background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
                transform: skewX(-20deg);
                animation: shimmer 2s infinite;
            `;
            resultCard.appendChild(shine);

            // 奖品名称
            const prizeText = document.createElement('div');
            prizeText.style.cssText = `
                font-size: ${winners.length === 1 ? '42px' : winners.length <= 3 ? '32px' : '26px'}px;
                font-weight: 700;
                color: #00ffff;
                text-shadow: 0 0 20px #00ffff, 0 0 40px #00ffff;
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
                color: #ffd700;
                text-shadow: 0 0 35px #ffd700, 0 0 70px #ff00de, 0 5px 20px rgba(0, 0, 0, 0.5);
                position: relative;
                z-index: 1;
                font-family: 'Arial Black', sans-serif;
            `;
            winnerText.textContent = winner;
            resultCard.appendChild(winnerText);

            resultsContainer.appendChild(resultCard);

            // 逐个弹出动画
            setTimeout(() => {
                resultCard.style.transition = 'all 1s cubic-bezier(0.68, -0.55, 0.265, 1.55)';
                resultCard.style.opacity = '1';
                resultCard.style.transform = 'scale(1) rotateZ(0deg)';
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
        for (let i = 0; i < 80; i++) {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position: absolute;
                width: ${12 + Math.random() * 10}px;
                height: ${12 + Math.random() * 10}px;
                background: ${['#ffd700', '#ff00de', '#00ffff', '#ff6b6b', '#4ecdc4'][Math.floor(Math.random() * 5)]};
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
        for (let i = 0; i < 16; i++) {
            const beam = document.createElement('div');
            beam.style.cssText = `
                position: absolute;
                width: 8px;
                height: 500px;
                background: linear-gradient(to bottom,
                    ${i % 2 === 0 ? 'rgba(255, 0, 222, 1)' : 'rgba(0, 255, 255, 1)'},
                    transparent);
                top: 50%;
                left: 50%;
                transform-origin: top center;
                transform: translate(-50%, -50%) rotate(${i * 22.5}deg);
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
