# BuilderSpace Hub

BuilderSpace 的内部管理工具：看板、任务分发、按项目授权。

它是开源项目 [Kan](https://github.com/kanbn/kan)（AGPL-3.0）的一个 fork。看板、成员、角色权限、评论、活动记录这些都来自上游；我们自己加的东西集中在 [`packages/builderspace`](packages/builderspace) 和本文件，尽量不改上游代码，方便以后同步上游更新。

实施计划和选型过程见 [BUILDERSPACE_PLAN.md](BUILDERSPACE_PLAN.md)。

## 结构

```
项目（工作区）        职能（看板）        任务（卡片）
社群            →   开发 / 运营 / 营销   →   待办 → 进行中 → 待验收 → 已完成
CourseMate      →   开发 / 运营 / 营销
EchoAgent       →   开发 / 运营 / 营销
```

| 我们的概念 | Hub 里对应 | 说明 |
| --- | --- | --- |
| 项目 | 工作区 Workspace | 权限按工作区授予：有哪几个项目的权限，就能看到、管理哪几个 |
| 职能 | 看板 Board | 每个项目固定三块：开发、运营、营销 |
| 任务 | 卡片 Card | 可指派成员、设截止日期、打标签、评论、拆清单 |
| 优先级 | 标签 Label | `P0` `P1` `P2` `卡住` |

这套结构定义在 [`packages/builderspace/src/structure.ts`](packages/builderspace/src/structure.ts)，改它再跑一次初始化即可（见下）。

## 权限

每个项目（工作区）单独设置，Hub 的 设置 → 权限 里可以逐项调整：

| 角色 | 默认能做什么 | 给谁 |
| --- | --- | --- |
| 管理员 admin | 全部，包括邀请成员、改权限、删工作区 | 核心团队 |
| 成员 member | 建看板，增删改列、任务、评论 | 参与该项目的人 |
| 访客 guest | 只读 | 志愿者（默认） |

目前核心团队三个人在三个项目里都是管理员。志愿者「可领取任务」的权限还没有做，见计划。

## 本地运行

需要 Node ≥ 20.18、pnpm 9（仓库的 `packageManager` 字段会自动选版本）、Docker。

```bash
pnpm install
```

起一个本地数据库。密码自己随便生成一个，只在本机用：

```bash
docker run -d --name builderspace-hub-db \
  -e POSTGRES_USER=hub -e POSTGRES_DB=hub -e POSTGRES_PASSWORD=<本地密码> \
  -p 127.0.0.1:54329:5432 -v builderspace-hub-db:/var/lib/postgresql/data postgres:17
```

在仓库根目录建 `.env`（已被 git 忽略，不要提交）：

```bash
NEXT_PUBLIC_BASE_URL=http://localhost:3000
BETTER_AUTH_SECRET=<32 位以上随机字符串：openssl rand -base64 32>
POSTGRES_URL=postgresql://hub:<本地密码>@127.0.0.1:54329/hub
NEXT_PUBLIC_ALLOW_CREDENTIALS=true
NEXT_PUBLIC_DISABLE_EMAIL=true
```

```bash
pnpm db:migrate
pnpm dev:next
```

打开 http://localhost:3000/signup 注册一个账号。

> **不要省略 `POSTGRES_URL`。** 不设置时应用会退回到内嵌数据库（PGlite），但登录接口和业务接口各开了一个实例，彼此看不到对方写入的数据，表现为「登录成功后马上被踢回登录页」。

## 初始化项目结构

1. 登录 Hub，进入 设置 → API，创建一个 API key。
2. 先预演，确认会创建什么：

```bash
HUB_URL=http://localhost:3000 HUB_API_KEY=<你的 key> pnpm --filter @kan/builderspace seed --dry-run
```

3. 去掉 `--dry-run` 正式执行。

初始化只补缺、不改动已有内容：工作区按 slug 识别，看板按名称，任务按标题。所以可以反复执行，也不会覆盖大家在 Hub 里已经改过的东西。API key 只从环境变量读取，不会写进日志；除 localhost 外只允许 https。

用同一条命令也可以初始化线上环境，把 `HUB_URL` 换成线上地址即可。

### 起始任务放在私有文件里

仓库是公开的，所以 `structure.ts` 里只有项目和职能，不放具体任务。要在初始化时顺便录入一批任务，把它们写进一个不提交的 JSON 文件（格式见 [`tasks.example.json`](packages/builderspace/tasks.example.json)），再用 `HUB_TASKS_FILE` 指给脚本：

```bash
HUB_URL=... HUB_API_KEY=... HUB_TASKS_FILE=packages/builderspace/tasks.local.json pnpm --filter @kan/builderspace seed --dry-run
```

`packages/builderspace/tasks.local.json` 已被 git 忽略。任务、成员、评论这些真实数据只存在数据库里，不进仓库。

## 部署（Vercel + Neon）

> 第 1–6 步已经按下面的做法实际走通：线上构建成功，登录页和健康检查（含数据库连接）正常。第 7、8 步（注册、初始化、关闭注册）还没在线上做过，做完请回来修正本节。

应用是一个 Next.js 单体（`apps/web`），没有常驻进程和 WebSocket，可以直接跑在 Vercel 上。数据库用 Vercel Marketplace 里的 Neon（免费档，闲置时自动休眠、访问时自动唤醒）。

1. **关联项目。** 在仓库根目录执行 `vercel link`，它会自动关联 GitHub 仓库，生产分支是 `main`。它还会改 `.gitignore` 并生成一个 `.env.local`，这两处都不需要，还原和删掉即可。
2. **项目设置。** Root Directory 设为 `apps/web`，Framework 选 Next.js，Node 22，函数区域选离团队最近的。
3. **数据库。** 只连到生产环境，区域和函数保持一致：

   ```bash
   vercel integration add neon --name <名字> --plan free_v3 -m region=<区域> -m auth=false -e production --no-env-pull
   ```

   它会自动注入 `POSTGRES_URL`（连接池地址，应用直接用）和 `POSTGRES_URL_NON_POOLING`（直连地址，迁移用）。CLI 还会往仓库里放 `.agents/`、`.claude/skills/` 和 `skills-lock.json`，不要提交。
4. **环境变量（生产环境）。**

   | 变量 | 值 |
   | --- | --- |
   | `NEXT_PUBLIC_BASE_URL` | 线上地址，要和实际访问的域名完全一致 |
   | `BETTER_AUTH_SECRET` | 新生成的随机串，设为 sensitive，**不要复用本地的** |
   | `NEXT_PUBLIC_ALLOW_CREDENTIALS` | `true` |
   | `NEXT_PUBLIC_DISABLE_EMAIL` | `true`（配好 SMTP 之前） |

   `NEXT_PUBLIC_ALLOW_CREDENTIALS` 名字里带 credentials，CLI 会当成密钥拦一下。它只是「允许邮箱密码登录」的开关，加 `--type config` 即可。
5. **迁移。** 用直连地址在本机跑：`POSTGRES_URL=<POSTGRES_URL_NON_POOLING 的值> NODE_ENV=production pnpm db:migrate`。以后每次同步上游带来新迁移时都要再跑一次。
6. **部署。** 合并到 `main` 即触发生产部署。其它分支不构建（项目的 Ignored Build Step 里跳过了非生产环境），因为预览环境没有数据库。**例外：新项目的第一次部署不管从哪个分支推送，都会被 Vercel 直接当成生产部署。** 所以第一次推送前要先把数据库、环境变量和迁移都准备好。部署后访问 `/api/v1/health`，应返回 `"database":"ok"`。
7. **注册并初始化。** 核心团队各自注册账号，按上一节初始化项目结构，再在每个项目的 成员 页用邀请链接互相拉进来。
8. **关闭公开注册。** 把 `NEXT_PUBLIC_DISABLE_SIGN_UP` 设为 `true` 重新部署。之后只有「已被邮箱邀请」的人能注册，而邮箱邀请需要先配好 SMTP；没配 SMTP 时要加新人，就临时打开注册，等对方注册并通过邀请链接加入后再关上。

两点注意：

- **访问保护。** 实测：项目的生产域名 `<项目名>.vercel.app` 可以公开访问；带哈希的单次部署地址和预览地址受团队的 Deployment Protection 保护，要登录 Vercel 才能看。把生产域名发给同事即可，不要发带哈希的地址。
- **限流。** 没配 Redis 时限流按实例内存计数，在 Serverless 上约束力有限；对外开放注册前应配上 `REDIS_URL`。

## 开发约定

- 我们的代码放在 `packages/builderspace`；确实需要改上游文件时，改动尽量小并在 PR 里说明原因。
- 先写测试再写实现，覆盖率不低于 80%：`pnpm --filter @kan/builderspace test:coverage`
- 提交前：`pnpm lint`、`pnpm typecheck`、`pnpm format:fix`
- 不提交任何密钥，也不提交内部数据（任务、成员名单、会议内容）。`.env`、`.env*.local` 和 `tasks.local.json` 已被忽略。
- 上游的约定（命名、数据库迁移、i18n）见 [AGENTS.md](AGENTS.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 同步上游

```bash
git fetch upstream
git merge upstream/main
pnpm install
pnpm db:migrate
```

`upstream` 的 push 地址已被禁用，不会误推到 Kan 官方仓库。

## 许可

Kan 采用 AGPL-3.0，这个 fork 也必须是。含义很具体：**只要有人通过网络使用我们部署的 Hub，我们就得向他们提供对应的源代码**，包括我们的修改。最简单的做法是把仓库设为公开。不能把它改成闭源产品。
