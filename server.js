const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
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

// OCR图片识别API - 导入报名玩家
app.post('/api/ocr-registration', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.json({ success: false, error: '未提供图片文件' });
        }

        // 获取人才库玩家列表
        const playersList = req.body.playersList ? JSON.parse(req.body.playersList) : [];

        // 构建玩家列表提示
        let playersHint = '';
        if (playersList && playersList.length > 0) {
            playersHint = `\n\n【人才库玩家列表】请严格从以下列表中匹配识别结果：\n${playersList.join('、')}`;
        }

        const prompt = `你是一个OCR识别助手。请识别这张图片中的玩家ID列表。这是报名玩家的名单，头像右侧或者下方一般是玩家ID。

识别要求：
1. 仔细识别每个中文字符，确保准确无误
2. 玩家ID通常是2-4个中文字符
3. 必须从人才库列表中匹配，不要识别出列表之外的名字
4. 如果图片模糊，请根据字形和人才库列表推断最接近的名字${playersHint}

请提取所有玩家ID，返回JSON数组格式：
["玩家ID1", "玩家ID2", "玩家ID3", ...]

重要：只返回JSON数组，不要添加任何解释或其他文字。`;

        // 压缩图片
        const compressedBuffer = await compressImage(req.file.buffer);

        // 将压缩后的图片转为base64（Claude API需要）
        const imageBase64 = `data:image/jpeg;base64,${compressedBuffer.toString('base64')}`;

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
                },
                timeout: 60000
            }
        );

        // 检查响应是否有效
        if (!response.data || !response.data.choices || !response.data.choices[0] || !response.data.choices[0].message) {
            throw new Error('API返回数据格式错误');
        }

        let aiResponse = response.data.choices[0].message.content;
        console.log('AI原始响应:', aiResponse);

        // 清理响应文本
        aiResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        // 检查是否是错误消息
        if (aiResponse.startsWith("I can't") || aiResponse.startsWith("I cannot")) {
            throw new Error('AI拒绝处理请求: ' + aiResponse);
        }

        const playerIds = JSON.parse(aiResponse);

        res.json({ success: true, playerIds });
    } catch (error) {
        console.error('OCR识别错误:', error.response?.data || error.message);

        res.json({
            success: false,
            error: error.message || '识别失败，请重试'
        });
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

        // 调用Claude API
        const prompt = `你是一个战略配队专家，基于对流派和玩家信息的理解，通过我给你的玩家ID和流派结合下方规则，进行合理的队伍分配。

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
1号位（核心领队/坦克）：肉陌、陌刀、陌双等高生存流派，负责吃伤害、占点、人墙
2-4号位（主力输出/控制）：无名、拳头、尘、九九等，负责推塔/打鹅/野区截杀
5号位（绝对续航）：固定纯奶（霖霖），确保小队续航

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

返回JSON格式（每队最多5人，5号位优先是纯奶）：
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
                max_tokens: 2048,
                messages: [{ role: 'user', content: prompt }]
            },
            {
                headers: {
                    'Authorization': 'Bearer cr_885a369a5301a04d886ad0af117dd27a90cbbb2b96fedd7ce1bd64aebf38369a',
                    'Content-Type': 'application/json'
                },
                timeout: 25000, // 25秒超时，留出缓冲时间
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

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据文件
function initDataFiles() {
    if (!fs.existsSync(PLAYERS_FILE)) {
        fs.writeFileSync(PLAYERS_FILE, JSON.stringify([], null, 2));
    }
    if (!fs.existsSync(TEAMS_FILE)) {
        fs.writeFileSync(TEAMS_FILE, JSON.stringify({}, null, 2));
    }
}

initDataFiles();

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
        fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));
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
        res.json({ success: true });
    } catch (error) {
        console.error('保存配队数据失败:', error);
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
