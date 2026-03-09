// 数据存储
let players = [];
let teams = {};
let currentBattleDate = new Date().toISOString().split('T')[0];

// DOM元素
const navBtns = document.querySelectorAll('.nav-btn');
const pages = document.querySelectorAll('.page');
const playerModal = document.getElementById('player-modal');
const playerForm = document.getElementById('player-form');
const addPlayerBtn = document.getElementById('add-player-btn');
const importPlayersBtn = document.getElementById('import-players-btn');
const importRegistrationBtn = document.getElementById('import-registration-btn');
const battleDateInput = document.getElementById('battle-date');
const smartAssignBtn = document.getElementById('smart-assign-btn');
const exportTeamBtn = document.getElementById('export-team-btn');
const loadHistoryBtn = document.getElementById('load-history-btn');
const createNewDateBtn = document.getElementById('create-new-date-btn');

// 从服务器加载数据
async function loadDataFromServer() {
    try {
        const [playersRes, teamsRes] = await Promise.all([
            fetch('/api/players'),
            fetch('/api/teams')
        ]);
        players = await playersRes.json();
        teams = await teamsRes.json();
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
    battleDateInput.value = currentBattleDate;
    await loadDataFromServer();
    renderTalentTable();
    loadTeamData(currentBattleDate);
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
    battleDateInput.addEventListener('change', (e) => {
        currentBattleDate = e.target.value;
        loadTeamData(currentBattleDate);
    });
    smartAssignBtn.addEventListener('click', handleSmartAssign);
    exportTeamBtn.addEventListener('click', handleExportTeam);
    loadHistoryBtn.addEventListener('click', showHistoryDialog);
    createNewDateBtn.addEventListener('click', createNewDateTeam);

    document.querySelector('.close').addEventListener('click', closePlayerModal);
    document.getElementById('cancel-btn').addEventListener('click', closePlayerModal);
    playerForm.addEventListener('submit', handlePlayerSubmit);

    // 粘贴事件监听
    setupPasteListener();

    setupDragAndDrop();
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
        Array.from(select.options).forEach(option => {
            option.selected = player.professions.includes(option.value);
        });

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
    const professions = Array.from(select.selectedOptions).map(opt => opt.value);
    const notes = document.getElementById('player-notes').value.trim();

    if (professions.length === 0 || professions.length > 2) {
        alert('请选择1-2个职业');
        return;
    }

    const player = { id, professions, notes };

    if (playerForm.dataset.editIndex !== undefined) {
        players[parseInt(playerForm.dataset.editIndex)] = player;
    } else {
        players.push(player);
    }

    savePlayers();
    renderTalentTable();
    closePlayerModal();
}

function editPlayer(index) {
    openPlayerModal(index);
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

    showLoading('AI正在分析配队，请耐心等待...');

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
            padding: 50px;
            background: linear-gradient(135deg, #f9f6f0 0%, #ede5d8 50%, #e8dcc8 100%);
            font-family: 'KaiTi', 'STKaiti', 'Microsoft YaHei', serif;
            position: relative;
        `;

        const teamData = teams[currentBattleDate];
        let content = `
            <div style="position: relative;">
                <!-- 装饰性水墨元素 -->
                <div style="position: absolute; top: -40px; left: 50%; transform: translateX(-50%); width: 300px; height: 80px; background: radial-gradient(ellipse, rgba(139,69,19,0.1) 0%, transparent 70%);"></div>
                <div style="position: absolute; top: 20px; left: 20px; width: 150px; height: 150px; border: 3px solid rgba(139,69,19,0.15); border-radius: 50%; opacity: 0.3;"></div>
                <div style="position: absolute; top: 40px; right: 40px; width: 100px; height: 100px; border: 2px solid rgba(139,69,19,0.15); border-radius: 50%; opacity: 0.3;"></div>

                <!-- 标题区域 -->
                <div style="text-align: center; margin-bottom: 35px; position: relative; z-index: 1;">
                    <div style="display: inline-block; position: relative;">
                        <div style="position: absolute; top: -15px; left: -30px; width: 60px; height: 60px; background: radial-gradient(circle, rgba(212,165,116,0.3) 0%, transparent 70%);"></div>
                        <div style="position: absolute; bottom: -15px; right: -30px; width: 60px; height: 60px; background: radial-gradient(circle, rgba(212,165,116,0.3) 0%, transparent 70%);"></div>
                        <h1 style="font-size: 58px; color: #8b4513; margin: 0; letter-spacing: 12px; text-shadow: 3px 3px 6px rgba(0,0,0,0.15); font-weight: bold; position: relative;">加州理工学院百业战安排</h1>
                    </div>
                    <div style="margin: 20px auto; width: 300px; height: 3px; background: linear-gradient(90deg, transparent, #d4a574 20%, #8b4513 50%, #d4a574 80%, transparent); position: relative;">
                        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 12px; height: 12px; background: #8b4513; border-radius: 50%; border: 2px solid #f9f6f0;"></div>
                    </div>
                    <p style="font-size: 26px; color: #a0826d; letter-spacing: 6px; margin: 0;">${currentBattleDate}</p>
                </div>
        `;

        ['attack', 'defense'].forEach((brigade, brigadeIdx) => {
            const brigadeName = brigade === 'attack' ? '进攻大队' : '防守大队';
            content += `
                <div style="margin-bottom: 35px; position: relative;">
                    <div style="position: absolute; top: -10px; left: -20px; width: 200px; height: 200px; background: radial-gradient(circle, rgba(139,69,19,0.05) 0%, transparent 70%); z-index: 0;"></div>
                    <h2 style="text-align: center; font-size: 38px; color: #8b4513; margin-bottom: 25px; letter-spacing: 8px; position: relative; z-index: 1;">
                        <span style="display: inline-block; padding: 10px 40px; border-top: 3px solid #d4a574; border-bottom: 3px solid #d4a574; background: linear-gradient(90deg, transparent, rgba(212,165,116,0.1) 20%, rgba(212,165,116,0.1) 80%, transparent);">${brigadeName}</span>
                    </h2>
                    <div style="display: flex; gap: 20px; position: relative; z-index: 1;">
            `;

            teamData[brigade].forEach((squad, squadIndex) => {
                content += `
                    <div style="flex: 1; background: linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%); border: 3px solid #d4a574; border-radius: 12px; padding: 15px; box-shadow: 0 8px 16px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.8); position: relative; overflow: hidden;">
                        <div style="position: absolute; top: 0; right: 0; width: 80px; height: 80px; background: radial-gradient(circle at top right, rgba(212,165,116,0.2) 0%, transparent 70%);"></div>
                        <h3 style="text-align: center; font-size: 26px; color: #8b4513; margin-bottom: 15px; letter-spacing: 4px; padding-bottom: 8px; border-bottom: 2px solid #d4a574; position: relative;">
                            小队${squadIndex + 1}
                            <div style="position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); width: 8px; height: 8px; background: #8b4513; border-radius: 50%; border: 2px solid #f9f6f0;"></div>
                        </h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="background: linear-gradient(135deg, rgba(212,165,116,0.4) 0%, rgba(212,165,116,0.25) 100%);">
                                    <th style="padding: 8px 6px; font-size: 16px; color: #8b4513; border-bottom: 2px solid #d4a574; text-align: left; font-weight: bold;">人员</th>
                                    <th style="padding: 8px 6px; font-size: 16px; color: #8b4513; border-bottom: 2px solid #d4a574; font-weight: bold;">流派</th>
                                    <th style="padding: 8px 6px; font-size: 16px; color: #8b4513; border-bottom: 2px solid #d4a574; font-weight: bold;">开局安排</th>
                                    <th style="padding: 8px 6px; font-size: 16px; color: #8b4513; border-bottom: 2px solid #d4a574; font-weight: bold;">后续安排</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                for (let i = 0; i < 5; i++) {
                    const member = squad[i];
                    const bgColor = i % 2 === 0 ? 'rgba(255,255,255,0.5)' : 'rgba(248,246,240,0.5)';
                    if (member) {
                        content += `
                            <tr style="background: ${bgColor}; border-bottom: 1px solid #e8dcc8;">
                                <td style="padding: 8px 6px; font-size: 16px; color: #5d4037; font-weight: bold;">${member.id}</td>
                                <td style="padding: 8px 6px; font-size: 13px; color: #6d4c41; text-align: center;">${(member.professions || []).join('、')}</td>
                                <td style="padding: 8px 6px; font-size: 14px; color: #5d4037; line-height: 1.4;">${member.startPlan || '-'}</td>
                                <td style="padding: 8px 6px; font-size: 14px; color: #5d4037; line-height: 1.4;">${member.followPlan || '-'}</td>
                            </tr>
                        `;
                    } else {
                        content += `
                            <tr style="background: ${bgColor}; border-bottom: 1px solid #e8dcc8;">
                                <td colspan="4" style="padding: 8px 6px; font-size: 14px; color: #bcaaa4; text-align: center; font-style: italic;">待分配对应玩家</td>
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
                <div style="margin-top: 40px; text-align: center;">
                    <div style="display: inline-block; width: 400px; height: 2px; background: linear-gradient(90deg, transparent, #d4a574, transparent);"></div>
                </div>
            </div>
        `;

        exportContainer.innerHTML = content;
        document.body.appendChild(exportContainer);

        const canvas = await html2canvas(exportContainer, {
            backgroundColor: '#f9f6f0',
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
function createNewDateTeam() {
    const newDate = prompt('请输入新的百业战日期（格式：YYYY-MM-DD）：', new Date().toISOString().split('T')[0]);
    if (newDate && /^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
        currentBattleDate = newDate;
        battleDateInput.value = newDate;
        if (!teams[newDate]) {
            teams[newDate] = {
                attack: [[], [], []],
                defense: [[], [], []],
                availablePlayers: []
            };
            saveTeams();
        }
        loadTeamData(newDate);
        alert(`已创建 ${newDate} 的配队`);
    } else if (newDate) {
        alert('日期格式不正确，请使用 YYYY-MM-DD 格式');
    }
}

// 历史记录
function showHistoryDialog() {
    const dates = Object.keys(teams).sort().reverse();
    if (dates.length === 0) {
        alert('暂无历史记录');
        return;
    }

    const historyModal = document.getElementById('history-modal');
    const historyList = document.getElementById('history-list');

    historyList.innerHTML = `
        <div class="history-dates">
            ${dates.map(date => {
                const teamData = teams[date];
                const totalPlayers = teamData.attack.flat().length + teamData.defense.flat().length;
                return `
                    <div class="history-item">
                        <div class="history-date">${date}</div>
                        <div class="history-info">配队人数：${totalPlayers}</div>
                        <div class="history-actions">
                            <button class="btn btn-primary" onclick="loadHistoryDate('${date}')">加载</button>
                            <button class="btn btn-danger" onclick="deleteHistoryDate('${date}')">删除</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    historyModal.classList.add('active');
}

function loadHistoryDate(date) {
    currentBattleDate = date;
    battleDateInput.value = date;
    loadTeamData(date);
    closeHistoryModal();
}

function deleteHistoryDate(date) {
    if (confirm(`确定删除 ${date} 的配队记录吗？`)) {
        delete teams[date];
        saveTeams();
        showHistoryDialog();
    }
}

function closeHistoryModal() {
    document.getElementById('history-modal').classList.remove('active');
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
        loading.remove();
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
