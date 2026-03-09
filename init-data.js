// 初始化数据模块
const fs = require('fs');
const path = require('path');

const INITIAL_PLAYERS = [
  { "id": "飞天大蟑螂", "professions": ["肉陌", "控制陌"] },
  { "id": "鬼公仔", "professions": ["陌双"] },
  { "id": "震霸天", "professions": ["陌九", "九九"] },
  { "id": "风千杨", "professions": ["十方陌", "陌刀"] },
  { "id": "以年", "professions": ["肉陌", "陌刀"] },
  { "id": "费曼", "professions": ["无名", "陌刀风扇"] },
  { "id": "常伴明月", "professions": ["陌奶", "陌刀风扇"] },
  { "id": "斩红郎", "professions": ["陌刀", "十方陌无名"] },
  { "id": "沈晔行", "professions": ["无名", "十方/风扇+无名"] },
  { "id": "秦兆丰", "professions": ["无名"] },
  { "id": "王荒炎", "professions": ["无名"] },
  { "id": "涂慕辞", "professions": ["无名"] },
  { "id": "寂渴", "professions": ["无名"] },
  { "id": "穗穗平安", "professions": ["无名"] },
  { "id": "柿水", "professions": ["无名"] },
  { "id": "宛有", "professions": ["无名"] },
  { "id": "攸风", "professions": ["无名"] },
  { "id": "晏极", "professions": ["无名", "打野"] },
  { "id": "三石", "professions": ["拳头"] },
  { "id": "起风了", "professions": ["无名"] },
  { "id": "好婉", "professions": ["尘尘", "尘"] },
  { "id": "撼山", "professions": ["无名"] },
  { "id": "柳雾轻烟", "professions": ["尘"] },
  { "id": "卫君肃", "professions": ["九九", "钩钩"] },
  { "id": "晴翼", "professions": ["尘"] },
  { "id": "十五重逢", "professions": ["唐伞", "九伞钩"] },
  { "id": "羽杉", "professions": ["钩钩"] },
  { "id": "青未觉", "professions": ["钩钩"] },
  { "id": "佟生战兔", "professions": ["钩钩"] },
  { "id": "水中月天上光", "professions": ["钩钩"] },
  { "id": "斩秋风", "professions": ["陌刀"] },
  { "id": "今早不想起", "professions": ["钩钩"] },
  { "id": "薛星辰", "professions": ["纯奶"] },
  { "id": "安平君祝", "professions": ["纯奶"] },
  { "id": "叶音绮", "professions": ["纯奶"] },
  { "id": "柴喵", "professions": ["纯奶"] },
  { "id": "禄歆", "professions": ["纯奶"] },
  { "id": "墨灵渊", "professions": ["纯奶", "双扇"] },
  { "id": "昭昭如曌", "professions": ["纯奶"] },
  { "id": "林镜流", "professions": ["纯奶"] },
  { "id": "寒沉烟", "professions": ["纯奶"] },
  { "id": "顾镜澄", "professions": ["纯奶"] },
  { "id": "青城山土豆精", "professions": ["纯奶", "输出奶"] },
  { "id": "南宫淮澜", "professions": ["纯奶"] },
  { "id": "江沄涧", "professions": ["纯奶"] },
  { "id": "百寂生", "professions": ["尘"] },
  { "id": "燕校长", "professions": ["无名剑法：鸣金·虹", "无名枪法：鸣金·虹"] },
  { "id": "不次宵夜", "professions": ["嗟夫刀法：裂石·威", "八方风雷枪：裂石·威"] },
  { "id": "曦嚯", "professions": ["明川药典：牵丝·霖", "千香引魂蛊：牵丝·霖"] },
  { "id": "一坨迷糊", "professions": ["嗟夫刀法：裂石·威", "八方风雷枪：裂石·威"] },
  { "id": "独孤少擎", "professions": ["无名剑法：鸣金·虹", "无名枪法：鸣金·虹"] }
];

const INITIAL_TEAMS = {};

function initializeData(dataDir, playersFile, teamsFile) {
    // 确保数据目录存在
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        console.log('创建数据目录:', dataDir);
    }

    // 初始化玩家数据
    if (!fs.existsSync(playersFile)) {
        fs.writeFileSync(playersFile, JSON.stringify(INITIAL_PLAYERS, null, 2));
        console.log('初始化玩家数据，共', INITIAL_PLAYERS.length, '名玩家');
    }

    // 初始化配队数据
    if (!fs.existsSync(teamsFile)) {
        fs.writeFileSync(teamsFile, JSON.stringify(INITIAL_TEAMS, null, 2));
        console.log('初始化配队数据');
    }
}

module.exports = { initializeData };
