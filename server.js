const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const { initializeData } = require('./init-data');
const { pullData, debouncedCommit } = require('./git-storage');

function generateUid() {
    return 'u' + Math.random().toString(36).substring(2, 11);
}
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// 文件上传配置
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// 图片压缩函数
async function compressImage(buffer) {
    try {
        // 压缩图片：最大宽度1200px，质量70%，转为JPEG
        const compressed = await sharp(buffer)
            .resize(1200, null, {
                withoutEnlargement: true,
                fit: 'inside'
            })
            .jpeg({ quality: 70 })
            .toBuffer();

        return compressed;
    } catch (error) {
        console.error('图片压缩失败:', error);
        return buffer; // 如果压缩失败，返回原始buffer
    }
}

// OCR图片识别API - 导入玩家
app.post('/api/ocr-players', async (req, res) => {
    try {
        const { imageBase64 } = req.body;

        if (!imageBase64) {
            return res.json({ success: false, error: '未提供图片数据' });
        }

        const prompt = `你是一个OCR识别助手。请识别这张图片中的玩家信息。图片中包含玩家ID和职业信息。

职业列表参考（请严格匹配）：
- 嗟夫刀法、八方风雷枪（裂石·威）
- 明川药典、千香引魂蛊（牵丝·霖）
- 无名剑法、无名枪法（鸣金·虹）
- 积矩九剑、九曲惊神枪（鸣金·影）
- 青山执笔、九重春色（牵丝·玉）
- 泥犁三垢、粟子游尘（破竹·风）
- 醉梦游春、粟子行云（破竹·尘）
- 斩雪刀法、十方破阵（裂石·钧）
- 天志垂象、千机索天（破竹·鸢）

识别要求：
1. 每个玩家通常有1-2个职业
2. 职业名称可能不完整，请根据上面的列表匹配最接近的完整职业名
3. 仔细识别每一行，不要遗漏任何玩家
4. 如果看到简称，请匹配完整名称（如"霖"对应"牵丝·霖"，"虹"对应"鸣金·虹"）

请提取每一行的玩家ID和职业信息，返回JSON数组格式：
[
  {"id": "玩家ID", "professions": ["职业1", "职业2"]},
  ...
]

重要：只返回JSON数组，不要添加任何解释或其他文字。`;

        const response = await axios.post(
            'https://cursor.scihub.edu.kg/api/v1/chat/completions',
            {
                model: 'claude-sonnet-4-6',
                max_tokens: 4096,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image_url', image_url: { url: imageBase64 } },
                        { type: 'text', text: prompt }
                    ]
                }]
            },
            {
                headers: {
                    'Authorization': 'Bearer cr_885a369a5301a04d886ad0af117dd27a90cbbb2b96fedd7ce1bd64aebf38369a',
                    'Content-Type': 'application/json'
                }
            }
        );

        let aiResponse = response.data.choices[0].message.content;
        console.log('AI原始响应:', aiResponse);

        // 清理响应文本
        aiResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        // 检查是否是错误消息
        if (aiResponse.startsWith("I can't") || aiResponse.startsWith("I cannot")) {
            throw new Error('AI拒绝处理请求: ' + aiResponse);
        }

        const players = JSON.parse(aiResponse);

        res.json({ success: true, players });
    } catch (error) {
        console.error('OCR识别错误:', error.response?.data || error.message);

        // 如果是JSON解析错误，返回原始AI响应
        let errorMsg = error.message;
        if (error.message.includes('JSON') && error.message.includes('token')) {
            errorMsg = `AI返回了非JSON格式的响应，请检查图片内容或重试`;
        }

        res.json({
            success: false,
            error: errorMsg
        });
    }
});

// 编辑距离（Levenshtein）用于模糊匹配
function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
        for (let j = 1; j <= n; j++)
            dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
                : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    return dp[m][n];
}

// 从OCR原始文本中模糊匹配已知玩家列表
function fuzzyMatchPlayers(rawText, playersList) {
    if (!playersList || playersList.length === 0) return [];
    const lines = rawText.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
    const matched = new Set();
    for (const line of lines) {
        // 先尝试直接包含
        for (const name of playersList) {
            if (line.includes(name)) {
                matched.add(name);
            }
        }
        // 再对每个词段做编辑距离匹配
        const segments = line.split(/[\s,，、|｜/\\]+/).filter(s => s.length >= 2);
        for (const seg of segments) {
            let best = null, bestDist = Infinity;
            for (const name of playersList) {
                const dist = levenshtein(seg, name);
                // 容忍度：每个字符最多1个错误，最多允许2个错误
                const threshold = Math.min(2, Math.floor(name.length / 2));
                if (dist <= threshold && dist < bestDist) {
                    bestDist = dist;
                    best = name;
                }
            }
            if (best) matched.add(best);
        }
    }
    return Array.from(matched);
}

// 多级强力模糊匹配：将原始OCR文本与玩家名单对比
function strongFuzzyMatch(rawText, playersList) {
    if (!playersList || playersList.length === 0) return [];
    const matched = new Set();

    // 把原始文本按各种分隔符切分为候选片段
    const lines = rawText.split(/[\n\r]+/);
    const candidates = new Set();
    for (const line of lines) {
        const segs = line.split(/[\s,，、|｜/\\:：\t]+/);
        for (const seg of segs) {
            const s = seg.trim();
            if (s.length >= 2) candidates.add(s);
        }
        const ltrim = line.trim();
        if (ltrim.length >= 2) candidates.add(ltrim);
    }

    // 对每个玩家名，在候选中做多级匹配
    for (const name of playersList) {
        if (!name || name.length === 0) continue;

        // 1. 原文直接包含玩家名（精确）
        if (rawText.includes(name)) { matched.add(name); continue; }

        // 2. 候选片段包含玩家名作为子串
        let found = false;
        for (const cand of candidates) {
            if (cand.includes(name)) { matched.add(name); found = true; break; }
        }
        if (found) continue;

        // 3. 玩家名包含候选片段（候选是玩家名的子串，长度 >= 2/3 玩家名长度）
        for (const cand of candidates) {
            if (cand.length >= 2 && name.includes(cand) && cand.length >= Math.ceil(name.length * 0.6)) {
                matched.add(name); found = true; break;
            }
        }
        if (found) continue;

        // 4. 编辑距离（动态阈值：长名字容忍更多差异）
        //    GLM-OCR 对复杂汉字可能多/少 1-2 字，放宽阈值
        const maxDist = name.length <= 2 ? 1 : name.length <= 4 ? 2 : 3;
        for (const cand of candidates) {
            if (Math.abs(cand.length - name.length) > maxDist) continue;
            if (levenshtein(cand, name) <= maxDist) { matched.add(name); break; }
        }
    }
    return Array.from(matched);
}

// Tesseract OCR 文字清理（去除汉字间多余空格 + 繁→简）
function cleanTessText(t) {
    const t2s = {'獨':'独','孤':'孤','擎':'擎','燕':'燕','長':'长','費':'费','曼':'曼','塗':'涂','墓':'慕','苔':'辞','師':'师','兄':'兄','風':'风','說':'说','條':'条','埋':'震','霸':'霸','彷':'仿','蔗':'蔗','滿':'潇','夜':'夜','地':'坨','糊':'糊','石':'石','君':'君','祝':'祝','攻':'攻','束':'慕','矢':'辞','此':'此','吵':'吵','滨':'擎','辣':'辣','點':'点','讓':'让','聞':'闻','端':'端','避':'避','滲':'渗','圖':'图','責':'责','訪':'访','會':'会','家':'家','舍':'舍','格':'格','僅':'仅'};
    let s = t;
    for (const [tra, sim] of Object.entries(t2s)) s = s.replace(new RegExp(tra, 'g'), sim);
    let prev = '';
    while (prev !== s) {
        prev = s;
        s = s.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
    }
    return s;
}

// Tesseract 双引擎识别，返回原始文本
async function ocrWithTesseract(imageBuffer) {
    const tessDataDir = path.resolve(__dirname);
    process.env.TESSDATA_PREFIX = tessDataDir;
    const tessBuffer = await sharp(imageBuffer)
        .resize({ width: 2400, withoutEnlargement: false })
        .grayscale()
        .normalise()
        .sharpen({ sigma: 2 })
        .png()
        .toBuffer();
    console.log('开始Tesseract OCR（chi_sim+chi_tra）...');
    const [simResult, traResult] = await Promise.allSettled([
        Tesseract.recognize(tessBuffer, 'chi_sim', { logger: () => {}, langPath: tessDataDir }),
        Tesseract.recognize(tessBuffer, 'chi_tra', { logger: () => {}, langPath: tessDataDir })
    ]);
    const simText = simResult.status === 'fulfilled' ? simResult.value.data.text : '';
    const traText = traResult.status === 'fulfilled' ? traResult.value.data.text : '';
    console.log('Tesseract chi_sim:', simText);
    console.log('Tesseract chi_tra:', traText);
    return cleanTessText(simText) + '\n' + cleanTessText(traText);
}

// GLM-OCR 识别，返回原始文本（使用 /layout_parsing 接口）
async function ocrWithGlmOcr(imageBuffer) {
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) throw new Error('未配置 ZHIPU_API_KEY，无法使用 GLM-OCR');

    // 压缩为 JPEG（降低体积，加快传输）
    const jpegBuffer = await sharp(imageBuffer)
        .resize(1200, null, { withoutEnlargement: true, fit: 'inside' })
        .jpeg({ quality: 85 })
        .toBuffer();
    // layout_parsing 接口要求 base64 带 MIME 前缀
    const base64Image = 'data:image/jpeg;base64,' + jpegBuffer.toString('base64');

    console.log('开始 GLM-OCR 识别（/layout_parsing）...');
    const response = await axios.post(
        'https://open.bigmodel.cn/api/paas/v4/layout_parsing',
        { model: 'glm-ocr', file: base64Image },
        {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        }
    );

    // 字段名为驼峰：layoutDetails / mdResults
    // content 中可能含 HTML 标签（如 <div align="center">），需剥离
    const stripHtml = (s) => s ? s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

    const data = response.data;
    const texts = [];

    // 从 layoutDetails 提取所有文字块的纯文本
    const details = data.layoutDetails || data.layout_details || [];
    for (const page of details) {
        for (const item of page) {
            if (item.content) texts.push(stripHtml(item.content));
        }
    }

    // 同时附加 mdResults（去掉图片引用和 HTML，保留纯文字）
    const md = data.mdResults || data.md_results || '';
    if (md) {
        const mdClean = md
            .replace(/!\[.*?\]\(.*?\)/g, ' ')  // 去掉 ![]() 图片引用
            .replace(/<[^>]+>/g, ' ')            // 去掉 HTML 标签
            .replace(/\s+/g, '\n').trim();
        texts.push(mdClean);
    }

    const glmText = texts.join('\n');
    console.log('GLM-OCR 提取文字:', glmText);
    return glmText;
}

// OCR图片识别API - 导入报名玩家
// 通过环境变量 OCR_ENGINE 选择引擎：'glm'（默认，需ZHIPU_API_KEY）或 'tesseract'
// Render 部署时自动检测：如果是生产环境且 GLM-OCR 超时，自动降级 Tesseract
app.post('/api/ocr-registration', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, error: '未提供图片文件' });
        }

        const playersList = req.body.playersList ? JSON.parse(req.body.playersList) : [];
        const hasGlmKey = !!process.env.ZHIPU_API_KEY;
        const isRender = !!process.env.RENDER; // Render 环境变量
        // Render 上强制用 Tesseract（GLM-OCR 从美国访问中国 API 太慢）
        const engine = isRender ? 'tesseract' : (process.env.OCR_ENGINE || (hasGlmKey ? 'glm' : 'tesseract'));

        let rawText;
        let engineUsed;
        if (engine === 'glm') {
            rawText = await ocrWithGlmOcr(req.file.buffer);
            engineUsed = 'GLM-OCR';
        } else {
            rawText = await ocrWithTesseract(req.file.buffer);
            engineUsed = 'Tesseract';
        }

        // 优先用 AI 语义匹配（有 playersList 时），再兜底模糊匹配
        let playerIds;
        if (playersList.length > 0) {
            playerIds = await aiMatchPlayers(rawText, playersList);
            if (!playerIds || playerIds.length === 0) {
                // AI 失败时降级到模糊匹配
                playerIds = strongFuzzyMatch(rawText, playersList);
            }
        } else {
            playerIds = rawText.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length >= 2);
        }

        console.log(`[${engineUsed}] 匹配结果:`, playerIds);
        res.json({ success: true, playerIds, engine: engineUsed });
    } catch (error) {
        console.error('OCR识别错误:', error.message);
        res.json({ success: false, error: error.message || '识别失败，请重试' });
    }
});

// AI语义匹配：把OCR文字和人才库发给 Claude，让其判断哪些文字是玩家名
async function aiMatchPlayers(ocrText, playersList) {
    try {
        const prompt = `以下是从报名截图中OCR识别出的文字（可能有识别偏差）：

${ocrText}

以下是人才库中的所有玩家ID（完整名单）：
${playersList.join('、')}

请判断OCR文字中出现了哪些玩家ID（即哪些玩家报名了）。
注意：OCR识别可能有错字、多字、少字，请结合相似度判断，如"飞天大翅蟑螂"对应"飞天大蟑螂"。

只返回一个JSON数组，包含实际出现在图片中的玩家ID（必须是人才库中存在的原始ID），格式：
["玩家ID1", "玩家ID2", ...]
不要输出任何解释。`;

        const response = await axios.post(
            'https://cursor.scihub.edu.kg/api/v1/chat/completions',
            {
                model: 'claude-sonnet-4-6',
                max_tokens: 1024,
                messages: [{ role: 'user', content: prompt }]
            },
            {
                headers: {
                    'Authorization': 'Bearer cr_885a369a5301a04d886ad0af117dd27a90cbbb2b96fedd7ce1bd64aebf38369a',
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        let aiResp = response.data.choices[0].message.content.trim();
        aiResp = aiResp.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const matched = JSON.parse(aiResp);
        // 过滤：只保留人才库中确实存在的名字
        return matched.filter(id => playersList.includes(id));
    } catch (error) {
        console.error('AI匹配失败:', error.message);
        return null; // 返回 null 表示失败，触发降级到模糊匹配
    }
}

// OCR对比测试API - 同时跑 GLM-OCR 和 Tesseract，返回两路结果供对比
app.post('/api/ocr-compare', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, error: '未提供图片文件' });
        }

        const playersList = req.body.playersList ? JSON.parse(req.body.playersList) : [];

        const [glmResult, tessResult] = await Promise.allSettled([
            ocrWithGlmOcr(req.file.buffer),
            ocrWithTesseract(req.file.buffer)
        ]);

        const glmText = glmResult.status === 'fulfilled' ? glmResult.value : null;
        const tessText = tessResult.status === 'fulfilled' ? tessResult.value : null;

        const glmPlayers = glmText ? (playersList.length > 0 ? strongFuzzyMatch(glmText, playersList) : []) : [];
        const tessPlayers = tessText ? (playersList.length > 0 ? strongFuzzyMatch(tessText, playersList) : []) : [];

        // 统计对比数据
        const onlyGlm = glmPlayers.filter(p => !tessPlayers.includes(p));
        const onlyTess = tessPlayers.filter(p => !glmPlayers.includes(p));
        const both = glmPlayers.filter(p => tessPlayers.includes(p));

        res.json({
            success: true,
            glm: {
                playerIds: glmPlayers,
                count: glmPlayers.length,
                rawText: glmText,
                error: glmResult.status === 'rejected' ? glmResult.reason.message : null
            },
            tesseract: {
                playerIds: tessPlayers,
                count: tessPlayers.length,
                rawText: tessText,
                error: tessResult.status === 'rejected' ? tessResult.reason.message : null
            },
            comparison: {
                bothRecognized: both,
                onlyGlm,
                onlyTesseract: onlyTess,
                glmAdvantage: onlyGlm.length - onlyTess.length
            }
        });
    } catch (error) {
        console.error('OCR对比错误:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// 智能配队API
app.post('/api/smart-assign', async (req, res) => {
    // 设置更短的超时时间以适应 serveo 限制
    req.setTimeout(40000); // 40秒
    res.setTimeout(40000);

    try {
        const { players } = req.body;

        if (!players || players.length === 0) {
            return res.json({ success: false, error: '没有可用玩家' });
        }

        console.log('开始智能配队，玩家数量:', players.length);

        // 读取历史配队数据作为参考
        let historyContext = '';
        try {
            const allTeams = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8'));
            const allPlayers = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
            // 构建 uid -> 当前昵称 映射
            const uidToName = {};
            for (const p of allPlayers) {
                if (p.uid) uidToName[p.uid] = p.id;
            }
            const historyDates = Object.keys(allTeams).sort().slice(-5); // 最近5个批次
            const historyExamples = [];
            for (const date of historyDates) {
                const t = allTeams[date];
                const squads = [];
                ['attack', 'defense'].forEach(side => {
                    const sideName = side === 'attack' ? '进攻' : '防守';
                    (t[side] || []).forEach((squad, idx) => {
                        if (!squad || squad.length === 0) return;
                        const members = squad.filter(Boolean).map(m => {
                            // 优先用uid查找当前昵称，回退到历史记录的id
                            const currentName = (m.uid && uidToName[m.uid]) ? uidToName[m.uid] : m.id;
                            return `${currentName}(${(m.professions||[]).join('/')})${m.startPlan ? ' 开局:'+m.startPlan : ''}${m.followPlan ? ' 后续:'+m.followPlan : ''}`;
                        }).join('、');
                        squads.push(`  ${sideName}${idx+1}队: ${members}`);
                    });
                });
                if (squads.length > 0) {
                    historyExamples.push(`【${date}】\n${squads.join('\n')}`);
                }
            }
            if (historyExamples.length > 0) {
                historyContext = `\n\n【历史配队参考（人工调整后的真实数据，请重点参考队伍组合、位置分配和安排策略）】\n${historyExamples.join('\n\n')}`;
            }
        } catch (e) {
            console.warn('读取历史配队数据失败:', e.message);
        }

        // 调用Claude API
        const prompt = `你是一个战略配队专家，基于对流派和玩家信息的理解，通过我给你的玩家ID和流派结合下方规则，进行合理的队伍分配。${historyContext}

玩家列表：
${players.map(p => {
    let info = `${p.id} - 职业：${p.professions.join('、')}`;
    if (p.notes) info += ` - 备注：${p.notes}`;
    return info;
}).join('\n')}

【流派简称对照】
- 威威/vv/肉陌 = 嗟夫刀法+八方风雷枪（裂石·威）
- 钧钧 = 斩雪刀法+十方破阵（裂石·钧）
- 霖霖/纯奶 = 明川药典+千香引魂蛊（牵丝·霖）
- 双扇 = 明川药典+青山执笔（奶+风墙控制）
- 虹虹/无名 = 无名剑法+无名枪法（鸣金·虹）
- 风风/双刀 = 泥犁三垢+粟子游尘（破竹·风）
- 鸢鸢/拳头 = 天志垂象+千机索天（破竹·鸢）

【纵向职能：1-5号位身份锚点】
1号位（核心领队/坦克）：肉陌、陌刀、陌双、十方陌、陌刀风扇等高生存流派，负责吃伤害、打控制、搬树等
2-4号位（主力输出/控制）：无名、拳头、尘、九九、双刀等，负责推塔/打鹅/野区截杀，击杀对方输出和奶妈
5号位（绝对续航）：固定纯奶（霖霖）、双扇等确保小队续航

【进攻团配队原则】
1队（主攻手）：1号位肉陌+2-4号位输出+5号位纯奶
- 开局：压下路转中路
- 后续：跟红车/护送红车

2队（主攻手）：1号位坦克+2-4号位输出+5号位纯奶
- 开局：压上路塔
- 后续：25/15 Boss/跟红车

3队（反野/奇袭）：1号位+2-4号位高机动输出+5号位纯奶
- 开局：人墙反野/对面外野下野
- 后续：25/15 Boss/双扇干扰/打对面伐木工

【防守团配队原则】
1队（野区卫士）：1号位队长+2-4号位输出+5号位纯奶
- 开局：守上塔/护我上野
- 后续：守蓝车杀人

2队（野区卫士）：1号位+2-4号位输出+5号位纯奶
- 开局：守下塔/护我下野
- 后续：守蓝车杀人

3队（中枢/抢Boss）：1号位+2-4号位输出+5号位纯奶
- 开局：中路人墙/守中塔
- 后续：守蓝车/抢25/15 Boss/打对面野区

【关键规则 - 必须严格遵守】
1. ⚠️ 每个玩家只能出现在一个小队中，绝对不能重复使用同一个玩家
2. ⚠️ 进攻团和防守团是完全独立的，不能有任何玩家同时出现在两个团中
3. 如果玩家数量不足，某些小队可以少于5人或为空
4. 优先保证每队有奶妈，如果奶妈不够，部分队伍可以没有奶妈

返回JSON格式（每队最多5人，1号位优先是陌刀，5号位优先是纯奶）：
{
  "attack": [
    [{"id": "玩家1", "professions": ["职业1", "职业2"], "startPlan": "压下路转中路", "followPlan": "跟红车"}, ...],
    [{"id": "玩家2", "professions": ["职业1", "职业2"], "startPlan": "压上路塔", "followPlan": "25/15 Boss"}, ...],
    [{"id": "玩家3", "professions": ["职业1", "职业2"], "startPlan": "人墙反野", "followPlan": "25/15 Boss"}, ...]
  ],
  "defense": [
    [{"id": "玩家4", "professions": ["职业1", "职业2"], "startPlan": "守上塔", "followPlan": "守蓝车杀人"}, ...],
    [{"id": "玩家5", "professions": ["职业1", "职业2"], "startPlan": "守下塔", "followPlan": "守蓝车杀人"}, ...],
    [{"id": "玩家6", "professions": ["职业1", "职业2"], "startPlan": "守中塔", "followPlan": "守蓝车/抢Boss"}, ...]
  ],
  "remaining": []
}

重要：只返回JSON对象，不要添加任何解释或其他文字。确保每个玩家ID只出现一次！`;

        const response = await axios.post(
            'https://cursor.scihub.edu.kg/api/v1/chat/completions',
            {
                model: 'claude-sonnet-4-6',
                max_tokens: 4096                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             ,
                messages: [{ role: 'user', content: prompt }]
            },
            {
                headers: {
                    'Authorization': 'Bearer cr_885a369a5301a04d886ad0af117dd27a90cbbb2b96fedd7ce1bd64aebf38369a',
                    'Content-Type': 'application/json'
                },
                timeout: 60000, // 60秒超时
                validateStatus: function (status) {
                    return status >= 200 && status < 600; // 接受所有状态码，手动处理
                }
            }
        );

        console.log('API响应状态:', response.status);

        // 检查 HTTP 状态码
        if (response.status === 502) {
            throw new Error('API服务暂时不可用，请稍后重试');
        }

        if (response.status >= 500) {
            throw new Error('API服务器错误，请稍后重试');
        }

        if (response.status >= 400) {
            throw new Error('请求失败，请检查网络连接');
        }

        // 检查响应是否有效
        if (!response.data) {
            console.error('API返回空数据');
            throw new Error('API返回空数据，请重试');
        }

        if (!response.data.choices || !response.data.choices[0] || !response.data.choices[0].message) {
            console.error('API返回数据格式错误:', JSON.stringify(response.data));
            throw new Error('API返回数据格式错误，请重试');
        }

        let aiResponse = response.data.choices[0].message.content;
        console.log('AI原始响应长度:', aiResponse.length);
        console.log('AI原始响应前100字符:', aiResponse.substring(0, 100));

        // 清理可能的markdown代码块标记
        aiResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        // 检查是否是错误消息
        if (aiResponse.startsWith("I can't") || aiResponse.startsWith("I cannot") || aiResponse.includes("I'm unable to")) {
            console.error('AI拒绝处理:', aiResponse);
            throw new Error('AI暂时无法处理请求，请稍后重试');
        }

        // 尝试解析JSON
        let assignment;
        try {
            assignment = JSON.parse(aiResponse);
            console.log('JSON解析成功');
        } catch (parseError) {
            console.error('JSON解析失败:', parseError.message);
            console.error('尝试解析的内容:', aiResponse);
            throw new Error('AI返回格式错误，请重试');
        }

        res.json({ success: true, assignment });
    } catch (error) {
        console.error('智能配队错误详情:', {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
            code: error.code
        });

        // 根据错误类型返回更友好的错误信息
        let errorMessage = '配队失败，请重试';

        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            errorMessage = '请求超时，请检查网络连接后重试';
        } else if (error.response?.status === 502) {
            errorMessage = 'API服务暂时不可用，请稍后重试';
        } else if (error.message) {
            errorMessage = error.message;
        }

        // 确保返回有效的JSON
        res.status(200).json({
            success: false,
            error: errorMessage
        });
    }
});

// 数据存储路径
const DATA_DIR = path.join(__dirname, 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');
const LOTTERIES_FILE = path.join(DATA_DIR, 'lotteries.json');

// 启动时从 GitHub 拉取最新数据
(async () => {
    await pullData();
    initializeData(DATA_DIR, PLAYERS_FILE, TEAMS_FILE);

    // 初始化抽奖数据文件
    if (!fs.existsSync(LOTTERIES_FILE)) {
        fs.writeFileSync(LOTTERIES_FILE, JSON.stringify([], null, 2));
    }

    // 为没有uid的玩家自动分配uid（迁移旧数据）
    try {
        const playersData = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
        let migrated = false;
        for (const p of playersData) {
            if (!p.uid) {
                p.uid = generateUid();
                migrated = true;
            }
        }
        if (migrated) {
            fs.writeFileSync(PLAYERS_FILE, JSON.stringify(playersData, null, 2));
            console.log('已为玩家自动分配uid');
        }
    } catch (e) {
        console.error('uid迁移失败:', e);
    }
})();

// 获取玩家数据
app.get('/api/players', (req, res) => {
    try {
        const data = fs.readFileSync(PLAYERS_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error('读取玩家数据失败:', error);
        res.json([]);
    }
});

// 保存玩家数据
app.post('/api/players', (req, res) => {
    try {
        const players = req.body;
        // 确保每个玩家都有uid
        for (const p of players) {
            if (!p.uid) p.uid = generateUid();
        }
        fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));

        // 自动提交到 GitHub（5秒防抖）
        debouncedCommit('更新玩家数据');

        res.json({ success: true });
    } catch (error) {
        console.error('保存玩家数据失败:', error);
        res.json({ success: false, error: error.message });
    }
});

// 获取配队数据
app.get('/api/teams', (req, res) => {
    try {
        const data = fs.readFileSync(TEAMS_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error('读取配队数据失败:', error);
        res.json({});
    }
});

// 保存配队数据
app.post('/api/teams', (req, res) => {
    try {
        const teams = req.body;
        fs.writeFileSync(TEAMS_FILE, JSON.stringify(teams, null, 2));

        // 自动提交到 GitHub（5秒防抖）
        debouncedCommit('更新配队数据');

        res.json({ success: true });
    } catch (error) {
        console.error('保存配队数据失败:', error);
        res.json({ success: false, error: error.message });
    }
});

// 获取抽奖数据
app.get('/api/lotteries', (req, res) => {
    try {
        const data = fs.readFileSync(LOTTERIES_FILE, 'utf8');
        res.json(JSON.parse(data));
    } catch (error) {
        console.error('读取抽奖数据失败:', error);
        res.json([]);
    }
});

// 保存抽奖数据
app.post('/api/lotteries', (req, res) => {
    try {
        const lotteries = req.body;
        fs.writeFileSync(LOTTERIES_FILE, JSON.stringify(lotteries, null, 2));

        // 自动提交到 GitHub（5秒防抖）
        debouncedCommit('更新抽奖数据');

        res.json({ success: true });
    } catch (error) {
        console.error('保存抽奖数据失败:', error);
        res.json({ success: false, error: error.message });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 启动服务器
app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`局域网访问地址: http://192.168.1.7:${PORT}`);
    console.log('使用 Cursor API (Claude Sonnet 4.6)');
    console.log(`数据存储目录: ${DATA_DIR}`);
});
