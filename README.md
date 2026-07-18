# 弗一把 (csgofriberg)

CS:GO / CS2 Major 选手猜测游戏 —— 工程化前后端分离版本。

类 Wordle 玩法:输入选手昵称,系统按 **国籍 / 赛区 / 队伍 / 年龄 / 位置 / Major 次数 / 现役状态** 逐属性给出对比反馈(绿=正确,黄=接近,↑↓=数值方向),8 次机会内猜出目标选手。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + Vite + TypeScript + React Router + Zustand |
| 后端 | Node.js + Express + TypeScript |
| 数据库 | SQLite (better-sqlite3),经 Knex 抽象,可切 PostgreSQL |
| 实时对战 | Socket.IO |
| 认证 | JWT + bcrypt |
| 校验/测试 | Zod / Vitest |
| 包管理 | pnpm workspaces |

## 功能

- 🔍 **查选手**:模糊搜索选手资料
- 🎮 **单人模式**:简单版(知名选手)/ 困难版(全部选手)
- 🌐 **多人联机**:BO1/3/5/7 赛制、随机匹配、5 位房间码、观战;每小局限时 120 秒,断线即时通知、同身份可重连,30 秒未归判负
- 所有模式**无需登录**:匿名访客战绩按浏览器本地标识记账,登录后自动并入账号
- 前后端交互仅传递**错误码**,文案统一在前端翻译(`client/src/i18n/messages.ts`)
- 📊 **生涯记录** / 🏆 **排行榜** / 📢 **公告**
- 🛠 **管理后台**:选手增删改、JSON 批量导入、公告管理(首个注册用户自动成为管理员)

## 快速开始

```bash
pnpm install
cp server/.env.example server/.env   # 可选,有默认值
pnpm dev                             # server: 3000, client: 5173
```

访问 http://localhost:5173 。首个注册的账号即管理员。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 同时启动前后端开发服务 |
| `pnpm build` | 构建前端 + 编译后端 |
| `pnpm start` | 生产模式启动(server 托管 client/dist) |
| `pnpm test` | 运行后端单测(游戏判定逻辑) |
| `pnpm migrate` | 初始化数据库结构 + 种子选手 |
| `pnpm seed` | 补充种子数据中缺失的选手 |

## 切换 PostgreSQL

修改 `server/.env`:

```
DB_CLIENT=pg
DB_URL=postgres://user:pass@localhost:5432/csgofriberg
```

## 目录结构

```
server/src
├── config.ts          # 环境配置
├── db/                # Knex 实例、建表、种子数据
├── middleware/        # JWT 认证、zod 校验、错误处理
├── routes/            # auth / players / game / stats / leaderboard / announcements / admin
├── services/          # gameService: 出题与属性对比判定(含单测)
└── socket/            # 多人房间系统
client/src
├── api/               # axios 封装、socket 单例
├── store/             # zustand auth
├── components/        # Layout / GuessBoard / PlayerSuggestInput / DataTable / admin/*
└── pages/             # Home / Login / Search / SingleGame / MultiLobby / MultiRoom / ...
```
