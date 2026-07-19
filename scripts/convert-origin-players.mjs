import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, 'origin', '弗一把Web', '弗一把Web', 'data');
const outputDir = path.join(repoRoot, 'data', 'imports');
const serverSeedDir = path.join(repoRoot, 'server', 'src', 'db', 'seeds');
const sourceFile = path.join(sourceDir, '全信息major选手总名单.txt');
const easySourceFile = path.join(sourceDir, '全信息major选手总名单简单版.txt');
const requiredColumns = [
  '选手ID',
  '选手昵称',
  '战队',
  '国籍',
  '年龄',
  '分工',
  'major冠军数',
  '参加major次数',
  '生日',
];

const regions = {
  独联体: ['俄罗斯', '白俄罗斯', '哈萨克斯坦', '阿塞拜疆', '乌兹别克斯坦'],
  欧洲: [
    '丹麦', '瑞典', '德国', '法国', '波兰', '乌克兰', '挪威', '比利时', '西班牙',
    '立陶宛', '拉脱维亚', '爱沙尼亚', '斯洛伐克', '塞尔维亚', '黑山', '罗马尼亚',
    '匈牙利', '捷克', '瑞士', '波黑', '北马其顿', '葡萄牙', '芬兰', '荷兰', '英国',
    '保加利亚', '斯洛文尼亚', '克罗地亚', '爱尔兰', '意大利', '塞尔维亚科索沃',
  ],
  亚洲: [
    '土耳其', '印度', '中国', '中国台湾', '中国香港', '印度尼西亚', '蒙古', '约旦',
    '马来西亚', '新加坡', '日本', '韩国', '泰国', '越南',
  ],
  大洋洲: ['澳大利亚', '新西兰'],
  非洲与以色列: ['南非', '以色列'],
  北美: ['美国', '加拿大', '危地马拉'],
  南美: ['巴西', '阿根廷', '智利', '哥伦比亚', '委内瑞拉', '乌拉圭'],
};

const regionMap = Object.fromEntries(
  Object.entries(regions).flatMap(([region, countries]) =>
    countries.map((country) => [country, region])
  )
);

const roleMap = {
  步枪手: 'Rifler',
  狙击手: 'AWPer',
  教练: 'Coach',
};

function parseInteger(value, field, nickname) {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed)) throw new Error(`${nickname}: invalid ${field}`);
  return parsed;
}

function parsePipeTable(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const headerIndex = lines.findIndex((line) =>
    requiredColumns.every((column) => line.includes(column))
  );
  if (headerIndex < 0) throw new Error(`${file}: missing table header`);
  const headers = lines[headerIndex]
    .split('|')
    .map((field) => field.trim())
    .filter(Boolean);
  const missingColumns = requiredColumns.filter((column) => !headers.includes(column));
  if (missingColumns.length) {
    throw new Error(`${file}: missing columns ${missingColumns.join(', ')}`);
  }
  return lines
    .slice(headerIndex + 1)
    .map((line) => line.trim())
    .filter((line) => /^\d+\s*\|/.test(line))
    .map((line, rowIndex) => {
      const values = line.split('|').map((field) => field.trim());
      while (values.length > headers.length && values.at(-1) === '') values.pop();
      if (values.length !== headers.length) {
        throw new Error(
          `${file}:${headerIndex + rowIndex + 2}: expected ${headers.length} columns, got ${values.length}`
        );
      }
      return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    });
}

const inferredBirthYears = [];
const unknownNationalities = new Set();
const unknownRoles = new Set();
const seenNicknames = new Set();
const duplicates = [];

const fullRows = parsePipeTable(sourceFile);
const easyRows = parsePipeTable(easySourceFile);
const players = fullRows.map((row) => {
    const nickname = row['选手昵称'];
    const team = row['战队'] || '未知';
    const nationality = row['国籍'] || '未知';
    const age = parseInteger(row['年龄'], 'age', nickname);
    const sourceRole = row['分工'] || '步枪手';
    const majorChampionships = parseInteger(
      row['major冠军数'],
      'major championships',
      nickname
    );
    const majorAppearances = parseInteger(
      row['参加major次数'],
      'major appearances',
      nickname
    );
    const birthday = row['生日'] || '';
    const birthdayYear = birthday.match(/(?:19|20)\d{2}/)?.[0];
    const birthYear = birthdayYear ? Number(birthdayYear) : 2026 - age;
    const region = regionMap[nationality];
    const role = roleMap[sourceRole];

    if (!birthdayYear) inferredBirthYears.push({ nickname, age, birth_year: birthYear });
    if (!region) unknownNationalities.add(nationality);
    if (!role) unknownRoles.add(sourceRole);
    const nicknameKey = nickname.toLocaleLowerCase('en-US');
    if (seenNicknames.has(nicknameKey)) duplicates.push(nickname);
    seenNicknames.add(nicknameKey);

    return {
      nickname,
      nationality,
      region: region || '未知',
      team,
      birth_year: birthYear,
      role: role || 'Rifler',
      major_championships: majorChampionships,
      major_appearances: majorAppearances,
      is_active: team !== '退役',
    };
  });

const fullNicknames = new Set(players.map((player) => player.nickname.toLocaleLowerCase('en-US')));
const easyNicknames = new Set(
  easyRows.map((row) => row['选手昵称'].toLocaleLowerCase('en-US'))
);
const missingEasyPlayers = easyRows
  .map((row) => row['选手昵称'])
  .filter((nickname) => !fullNicknames.has(nickname.toLocaleLowerCase('en-US')));
for (const player of players) {
  player.is_easy = easyNicknames.has(player.nickname.toLocaleLowerCase('en-US'));
}

if (unknownNationalities.size || unknownRoles.size || duplicates.length || missingEasyPlayers.length) {
  throw new Error(JSON.stringify({
    unknownNationalities: [...unknownNationalities],
    unknownRoles: [...unknownRoles],
    duplicates,
    missingEasyPlayers,
  }, null, 2));
}

const report = {
  sources: {
    full: path.relative(repoRoot, sourceFile).replaceAll('\\', '/'),
    easy: path.relative(repoRoot, easySourceFile).replaceAll('\\', '/'),
  },
  generated_at: new Date().toISOString(),
  player_count: players.length,
  source_easy_player_count: easyRows.length,
  easy_player_count: players.filter((player) => player.is_easy).length,
  inactive_count: players.filter((player) => !player.is_active).length,
  inferred_birth_years: inferredBirthYears,
  rules: {
    birth_year: '优先读取生日年份；缺失时使用 2026 - 原始年龄。',
    major_championships: '按表头读取 major冠军数 列。',
    major_appearances: '按表头读取 参加major次数 列。',
    role: '仅保留 Rifler、AWPer、Coach 三种英文值，前端统一映射为中文。',
    is_easy: '按原始简单版表回填一次，后续由管理员手动维护。',
    is_active: '战队字段严格等于“退役”时为 false，其他状态为 true。',
    region: '按照原始国家赛区对照文件转换为当前项目使用的短赛区名称。',
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  path.join(outputDir, 'players-origin.json'),
  `${JSON.stringify(players, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(outputDir, 'region-map.json'),
  `${JSON.stringify(regionMap, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(outputDir, 'conversion-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(serverSeedDir, 'major-championships.json'),
  `${JSON.stringify(
    players
      .filter((player) => player.major_championships > 0)
      .map(({ nickname, major_championships }) => ({ nickname, major_championships })),
    null,
    2
  )}\n`,
  'utf8'
);
fs.writeFileSync(
  path.join(serverSeedDir, 'easy-players.json'),
  `${JSON.stringify(
    players.filter((player) => player.is_easy).map(({ nickname }) => ({ nickname })),
    null,
    2
  )}\n`,
  'utf8'
);

console.log(JSON.stringify({ outputDir, ...report }, null, 2));
