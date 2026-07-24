# 弗一把 (csgofriberg)

CS:GO / CS2 Major 选手猜测游戏 —— 工程化前后端分离版本。

类 Wordle 玩法:输入选手昵称,系统按 **国家或地区 / 赛区 / 队伍 / 年龄 / 位置 / Major 冠军数 / Major 次数 / 现役状态** 逐属性给出对比反馈(绿=正确,黄=接近,↑↓=数值方向),8 次机会内猜出目标选手。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + Vite + TypeScript + React Router + Zustand |
| 后端 | Node.js + Express + TypeScript |
| 数据库 | 本地开发支持 SQLite；生产 Docker 镜像固定使用 PostgreSQL |
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
- 📊 **统计** / 🏆 **排行榜** / 📢 **公告**
- 🛠 **管理后台**:选手增删改、JSON 批量导入、公告管理(管理员通过部署命令创建)

## 快速开始

```bash
pnpm install
cp server/.env.example server/.env   # 可选,有默认值
pnpm dev                             # server: 3000, client: 5173
```

Redis 默认连接 `redis://127.0.0.1:6379`。生产环境建议设置
`REDIS_REQUIRED=true`，避免 Redis 故障时降级为仅适合单实例的内存模式。

生产环境还会强制要求 PostgreSQL、至少 32 字节的随机 `JWT_SECRET` 和
`REDIS_REQUIRED=true`。访客显示 ID 使用 HMAC-SHA256 派生，可通过
`GUEST_ID_SALT` 配置独立盐，未配置时复用 `JWT_SECRET`。登录会话与匿名身份均使用
HttpOnly、SameSite Cookie，客户端不保存 JWT 或匿名身份密钥。

单人进行中的对局只保存在 Redis，300 秒无有效操作会自动过期。猜中、
次数耗尽或查看答案后才写入数据库；主动离开或重新开始只清理临时状态，
不会产生历史战绩。

创建或重置管理员：

```bash
ADMIN_USERNAME=admin ADMIN_PASSWORD='至少12位强密码' pnpm create-admin
```

访问 http://localhost:5173 。公开注册账号默认都是普通用户。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `pnpm dev` | 同时启动前后端开发服务 |
| `pnpm build` | 构建前端 + 编译后端 |
| `pnpm start` | 生产模式启动(server 托管 client/dist) |
| `pnpm test` | 运行后端单测(游戏判定逻辑) |
| `pnpm migrate` | 初始化数据库结构 + 种子选手 |
| `pnpm seed` | 补充种子数据中缺失的选手 |
| `pnpm create-admin` | 显式创建或重置管理员 |
| `pnpm loadtest` | 运行 HTTP 缓存接口与多人建房负载测试 |

## Docker 生产部署

生产环境使用 PostgreSQL 专用的精简 Docker 镜像。GitHub Actions 自动执行
测试、前后端编译、`linux/amd64` 镜像构建，并发布到
`ghcr.io/xinhai-ai/csgofriberg`。运行镜像不包含 Rust、pnpm、TypeScript、Vite、
源码、测试、构建工具或 SQLite 驱动。

Docker Compose 部署、自动数据库迁移、管理员创建、更新和回滚方法位于
[`deploy/README.md`](deploy/README.md)。

### Umami 访问统计

部署环境中设置 `UMAMI_WEBSITE_ID` 后，前端会在运行时加载 Umami 统计脚本；留空则完全关闭统计。默认使用 Umami Cloud：

```env
UMAMI_WEBSITE_ID=your-website-id
UMAMI_SCRIPT_URL=https://cloud.umami.is/script.js
```

自托管 Umami 时，将 `UMAMI_SCRIPT_URL` 改为实例提供的脚本完整地址。配置由服务端在运行时提供，因此更改统计站点不需要重新构建前端镜像，只需重启应用服务。

## Redis 用途

- HTTP 与 Socket.IO 分布式限流
- HttpOnly Cookie 会话、实时角色校验和匿名身份签名绑定
- `/api/players/list` 版本化缓存、ETag 与跨实例失效通知
- 排行榜、公告等热点查询缓存
- 多人房间快照、身份索引、分布式房间锁和匹配队列
- 回合超时、断线判负和房间清理的可恢复调度
- Socket.IO Redis Adapter 跨实例广播
- Redis Stream 多人战绩持久化重试

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
