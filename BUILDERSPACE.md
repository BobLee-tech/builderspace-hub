# BuilderSpace Hub

BuilderSpace 的内部管理工具：看板、任务分发、按项目授权。

**可以用 CLI 测试**：命令行工具 [`bshub`](https://github.com/EdwinjJ1/builderspace-hub-cli) 能对本地或测试用的 Hub 跑端到端冒烟测试，见下文「用 CLI 测试」。

它是开源项目 [Kan](https://github.com/kanbn/kan)（AGPL-3.0）的一个 fork。看板、成员、角色权限、评论、活动记录这些都来自上游；我们自己加的东西集中在 [`packages/builderspace`](packages/builderspace) 和本文件，尽量不改上游代码，方便以后同步上游更新。

选型过程见 [BUILDERSPACE_PLAN.md](BUILDERSPACE_PLAN.md)，接下来做什么见 [docs/hub/ROADMAP.md](docs/hub/ROADMAP.md)，代码怎么组织见 [docs/hub/ARCHITECTURE.md](docs/hub/ARCHITECTURE.md)。

## 结构

```
项目（工作区）        职能（看板）        任务（卡片）
社群            →   开发 / 运营 / 营销   →   待办 → 进行中 → 待验收 → 已完成
CourseMate      →   开发 / 运营 / 营销
EchoAgent       →   开发 / 运营 / 营销
```

| 我们的概念 | Hub 里对应       | 说明                                                       |
| ---------- | ---------------- | ---------------------------------------------------------- |
| 项目       | 工作区 Workspace | 权限按工作区授予：有哪几个项目的权限，就能看到、管理哪几个 |
| 职能       | 看板 Board       | 每个项目固定三块：开发、运营、营销                         |
| 任务       | 卡片 Card        | 可指派成员、设截止日期、打标签、评论、拆清单               |
| 优先级     | 标签 Label       | `P0` `P1` `P2` `卡住`                                      |

这套结构定义在 [`packages/builderspace/src/structure.ts`](packages/builderspace/src/structure.ts)，改它再跑一次初始化即可（见下）。

## 权限

每个项目（工作区）单独设置，Hub 的 设置 → 权限 里可以逐项调整：

| 角色         | 默认能做什么                         | 给谁           |
| ------------ | ------------------------------------ | -------------- |
| 管理员 admin | 全部，包括邀请成员、改权限、删工作区 | 核心团队       |
| 成员 member  | 建看板，增删改列、任务、评论         | 参与该项目的人 |
| 访客 guest   | 只读                                 | 志愿者（默认） |

目前核心团队三个人在三个项目里都是管理员。志愿者「可领取任务」的权限还没有做，见路线图。

## 文档

侧栏的「文档」是团队的文档库：方案、说明、笔记这类内容，用 **Markdown** 或 **HTML** 直接在页面里写和编辑，按文件夹整理。也可以点「上传文件」传 `.md`、`.html` 或 Word（`.docx`）：Word 在浏览器里转成 Markdown（标题、列表、表格、链接保留，图片、字体、页眉页脚不保留，原文件不存），内容先填进「新建文档」，确认后再保存。不存附件（没有 PDF、PPT，老的 `.doc` 要先另存为 `.docx`），所以不需要对象存储，也没有任何额外的环境变量：内容存在数据库里，每份最大 400 KB。

| 想做的事                                               | 谁能做                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 查看                                                   | 所有登录的成员。每份文档有「所有成员可读」开关；关掉后只有能修改它的人看得到，列表里标「仅编辑者可见」 |
| 新建文件夹、新建文档                                   | 所有者和管理员                                                                                         |
| 修改一份文档（标题、说明、内容、移动、删除、可读开关） | 所有者，以及被指派给这份文档的人。管理员不是所有文档的编辑者，要被指派                                 |
| 指派修改权限、处理申请                                 | 所有者，和这份文档的管理员编辑者                                                                       |
| 申请修改权限                                           | 其他成员在文档页写一句理由提交，由上一行的人同意或拒绝                                                 |

写文档的人自动成为它的编辑者。所有改动（新建、改内容、改名、移动、指派、申请、同意、拒绝、删除）都写进后台的操作日志。

**渲染**：Markdown 在页面里直接渲染（里面的原始 HTML 不会被当成 HTML，危险的链接地址会被去掉）；HTML 在沙箱里显示：脚本能运行，但碰不到本站的登录状态和数据。HTML 要自成一体：外链样式、本地图片不会自动带上，需要内联或用 https 地址。

**命令行**：`bshub doc +create --title "讲稿" --file 讲稿.md --private`（[CLI 仓库](https://github.com/EdwinjJ1/builderspace-hub-cli)）走 `/api/hub/v1/documents`，用 API key 登录。可以读、新建、改信息、换内容；**不能删除，也不能分配修改权限**，这两件只在网页里做。只收 `.md` 和 `.html`。

另有一项**官网权限**，和上面的角色、后台角色都无关，由所有者在 后台 → 账号 里逐人设置：「名单」能看志愿者申请和加入登记、改志愿者的状态和备注；「管理」在此之外还能审核官网的项目卡和项目进展。没有设置的人（包括所有者自己）看不到官网的数据。

## 开通新成员

Hub 不开放公开注册，`/signup` 只是一页说明。要让一个人注册，先给他的邮箱发一条注册许可，得到一条一次性链接，私下发给本人：

```bash
pnpm --filter @kan/hub cli projects
```

```bash
pnpm --filter @kan/hub cli grant --email someone@example.com --project <项目ID>:member
```

- `--project` 可以写多次，角色是 `admin`、`member` 或 `guest`（只读），不写角色默认 `member`。
- 链接只显示这一次，7 天内有效，只能用一次，只能用于这个邮箱。再发一条会让上一条失效。
- 对方打开链接，填称呼和密码就完成注册，并自动加入预设的项目。
- 命令读取根目录 `.env` 里的 `POSTGRES_URL` 和 `NEXT_PUBLIC_BASE_URL`。对线上操作时把这两个变量写在命令前面（已有的环境变量优先于 `.env`）。
- 每次发放和使用都会写进操作日志（`hub_audit_log` 表）。
- 万一有人注册成功却没被加进项目（极少见，服务端日志里会有 `Provisioning after registration failed`），执行 `pnpm --filter @kan/hub cli provision --email <邮箱>` 补齐，可以重复执行。

后台做好之后，这些都可以在网页上点。

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
pnpm --filter @kan/hub migrate
pnpm dev:next
```

第一条跑 Kan 的迁移，第二条跑 Hub 自己的（两条流水分开记录，原因见架构文档）。然后给自己发一条注册许可，打开打印出来的链接完成注册：

```bash
pnpm --filter @kan/hub cli grant --email you@example.com --hub-role owner
```

> **不要省略 `POSTGRES_URL`。** 不设置时应用会退回到内嵌数据库（PGlite），但登录接口和业务接口各开了一个实例，彼此看不到对方写入的数据，表现为「登录成功后马上被踢回登录页」。

## 用 CLI 测试

[`bshub`](https://github.com/EdwinjJ1/builderspace-hub-cli) 是 Hub 的命令行工具（给人用，也给 AI Agent 用），同时是 Hub 的端到端测试工具。本地跑起 Hub 后，在「设置 → API」建一个 key，再挑一块测试用的看板：

```bash
git clone https://github.com/EdwinjJ1/builderspace-hub-cli.git && cd builderspace-hub-cli
pnpm install
BSHUB_URL=http://localhost:3000 BSHUB_API_KEY=<key> BSHUB_SMOKE_BOARD=<看板 publicId> pnpm smoke
```

它会依次检查 Hub 可达和登录，读取项目和任务，然后新建一个任务、换列、改截止日期、评论、读回核对、删除；任何一步失败都返回非零退出码。改动了任务、看板、权限或登录相关的代码，提 PR 前跑一遍。

> **只对本地或测试实例跑，不要指向线上。** 冒烟测试会真的新建、修改、删除任务；中途失败时，建好的测试任务会留在那块看板上。

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

   | 变量                            | 值                                                 |
   | ------------------------------- | -------------------------------------------------- |
   | `NEXT_PUBLIC_BASE_URL`          | 线上地址，要和实际访问的域名完全一致               |
   | `BETTER_AUTH_SECRET`            | 新生成的随机串，设为 sensitive，**不要复用本地的** |
   | `NEXT_PUBLIC_ALLOW_CREDENTIALS` | `true`                                             |
   | `NEXT_PUBLIC_DISABLE_EMAIL`     | `true`（配好 SMTP 之前）                           |

   `NEXT_PUBLIC_ALLOW_CREDENTIALS` 名字里带 credentials，CLI 会当成密钥拦一下。它只是「允许邮箱密码登录」的开关，加 `--type config` 即可。

   **连接 GitHub（可选）。** 个人页的 GitHub 统计用 Hub 自己的 GitHub App。在 GitHub → Settings → Developer settings → GitHub Apps 新建（社团仓库在组织下就建在组织下）：Callback URL 填 `<线上地址>/api/hub/github/callback`；保留 "Expire user authorization tokens"；Webhook 不勾 Active；仓库权限 Contents、Pull requests、Issues 都设为 **Read-only**。建好后生成 Client secret，把 App 安装到社团的仓库上，再加两个环境变量：

   | 变量                       | 值                              |
   | -------------------------- | ------------------------------- |
   | `HUB_GITHUB_CLIENT_ID`     | App 的 Client ID                |
   | `HUB_GITHUB_CLIENT_SECRET` | App 的 Client secret，sensitive |

   **不要用 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` 这两个名字**：那是 Kan 自己的变量，设了会打开「用 GitHub 登录」，绕过注册闸门。没设这两个变量时，个人页显示「GitHub 连接还没开通」。然后在后台「项目仓库」里给每个项目配好仓库。

5. **迁移。** 用直连地址在本机跑两条：`POSTGRES_URL=<POSTGRES_URL_NON_POOLING 的值> NODE_ENV=production pnpm db:migrate`（Kan 的），再把末尾换成 `pnpm --filter @kan/hub migrate`（Hub 的）。之后用同样的变量跑 `pnpm --filter @kan/hub cli doctor` 确认 Hub 迁移已是最新。同步上游带来新迁移，或者 PR 里带了新的 Hub 迁移时，都要在合并前再跑一次。
6. **部署。** 合并到 `main` 即触发生产部署。其它分支不构建（项目的 Ignored Build Step 里跳过了非生产环境），因为预览环境没有数据库；合并前的构建检查由 CI 的 `web` 任务代替，它红了就不要合并。**例外：新项目的第一次部署不管从哪个分支推送，都会被 Vercel 直接当成生产部署。** 所以第一次推送前要先把数据库、环境变量和迁移都准备好。部署后访问 `/api/v1/health`，应返回 `"database":"ok"`。
7. **注册并初始化。** 先给第一位所有者发注册许可（`--hub-role owner`，对线上操作时带上线上的 `POSTGRES_URL` 和 `NEXT_PUBLIC_BASE_URL`）。他注册后执行 `pnpm --filter @kan/hub cli setup-projects --owner <他的邮箱>`，按标准结构建好三个项目和九块看板，他成为各项目管理员。之后再给其他人发许可，用 `--project <项目ID>:<角色>` 预设项目（项目 ID 用 `cli projects` 查）。
8. **不要设置 `NEXT_PUBLIC_DISABLE_SIGN_UP`。** 那是 Kan 自己的开关，和 Hub 的注册闸门是「与」的关系：打开之后光有注册链接也会被拒。有闸门在，没有许可的人本来就注册不了。

两点注意：

- **访问保护。** 实测：项目的生产域名 `<项目名>.vercel.app` 可以公开访问；带哈希的单次部署地址和预览地址受团队的 Deployment Protection 保护，要登录 Vercel 才能看。把生产域名发给同事即可，不要发带哈希的地址。
- **限流。** 登录、注册、重置密码和注册链接检查的限流计数在数据库里（`hub_rate_limit`），不依赖 Redis，见 [docs/hub/ARCHITECTURE.md](docs/hub/ARCHITECTURE.md) 的「限流」。Kan 其余接口的限流没配 Redis 时仍按实例内存计数。

## 连接官网（后台的「官网」分区）

后台的「官网」分区直接读写官网自己的 Supabase 数据库。Hub 用一个专用的数据库角色 `hub_site_admin` 连过去：它只能读项目卡、项目进展、志愿者申请、加入登记四张表，只能改审核状态、志愿者状态和备注，不能增删行，碰不到 auth、storage 和其他表。不要把官网的 service_role key 交给 Hub。

1. **建角色。** 官网仓库合并迁移 `supabase/migrations/20261015020000_hub_site_admin.sql`，并应用到官网的 Supabase 项目。这一步要由有官网 Supabase 权限的人做。
2. **设密码。** 在官网 Supabase 的 SQL Editor 执行一次，密码新生成一个足够长的随机串：

   ```sql
   alter role hub_site_admin with login password '<新密码>';
   ```

3. **连接串。** Supabase → Connect → Transaction pooler 复制连接串，把用户名换成 `hub_site_admin.<project ref>`、密码换成上一步的。
4. **证书。** Supabase → Project Settings → Database → SSL Configuration → Download certificate。Hub 连非本机的数据库时一律走 TLS 并校验证书，Supabase 的证书由它自己的 CA 签发，所以要把这份根证书给 Hub。
5. **环境变量（Hub 的生产环境）。**

   | 变量                    | 值                                                          |
   | ----------------------- | ----------------------------------------------------------- |
   | `HUB_SITE_DATABASE_URL` | 第 3 步的连接串，设为 sensitive                             |
   | `HUB_SITE_DATABASE_CA`  | 第 4 步证书文件的全部内容（多行，或者把换行写成 `\n` 也行） |

6. **重新部署，再授权。** 部署后，所有者在 后台 → 账号 里给需要的人设「官网权限」。没设变量时，有官网权限的人会看到「还没有连接官网数据库」。
7. **停用。** 在官网 Supabase 执行 `alter role hub_site_admin nologin;`，或删掉 Hub 的这两个环境变量。

### 录取后自动发注册链接

所有者或管理员在 后台 → 官网 → 志愿者申请 里把申请改成「已录取」，Hub 会给申请人的邮箱发一封欢迎邮件，里面是他自己的注册链接（7 天有效，注册后加入「BuilderSpace 社团」项目，成员角色）。卡片上显示这个人的 Hub 状态（还没发 / 已发、几号到期 / 已过期 / 已注册），可以点「发注册链接」「重发注册链接」。设计细节见 [docs/hub/ARCHITECTURE.md](docs/hub/ARCHITECTURE.md) 的「录取后自动发链接」。

发信走 Resend，要在 Hub 的生产环境加：

| 变量                 | 值                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `HUB_RESEND_API_KEY` | Resend 的 API key，sensitive。建议单独建一个只有 Sending access、只限发信域名的 key                            |
| `HUB_MAIL_FROM`      | 可选，发件人，默认 `BuilderSpace 创客社 <hello@builderspace.dev>`，域名要在 Resend 里验证过                    |
| `HUB_MAIL_REPLY_TO`  | 建议设，收件人点「回复」时发到哪里（比如负责人的邮箱）。不设时，邮件里不会让人回复，改成请对方在社团群里说一声 |

**不要用 `SMTP_*`、`EMAIL_FROM`**：那是 Kan 自己的发信配置，设了会打开 Kan 的邀请和魔法链接邮件，绕过注册闸门。没设 `HUB_RESEND_API_KEY` 时，改成「已录取」照常生效，但不发链接，页面会提示。

本地开发时把 `HUB_SITE_DATABASE_URL` 指向一个本机 Postgres 即可（本机地址不走 TLS），里面按官网的迁移建好表，测试用的最小表结构见 `packages/hub/src/testing/site-test-db.ts`。

## 开发约定

- 完整的约定和「加一个功能」的步骤见 [docs/hub/CONTRIBUTING.md](docs/hub/CONTRIBUTING.md)。
- 我们的代码放在自己的目录里（`packages/hub`、`apps/web/src/hub` 等）；上游文件只在登记过的接缝处改，见 [docs/hub/UPSTREAM_SEAMS.md](docs/hub/UPSTREAM_SEAMS.md)，用 `pnpm --filter @kan/hub check-seams` 检查。
- 先写测试再写实现，覆盖率不低于 80%：`pnpm --filter @kan/hub test:coverage`
- 提交前：`pnpm lint`、`pnpm typecheck`、`pnpm format:fix`
- 改了网页（`apps/web`）的：`pnpm --filter @kan/web build && pnpm --filter @kan/hub check-web-types`。Kan 自己的网页代码有类型错误，`@kan/web` 的 typecheck 本来就不过，后一条只看 Hub 自己的文件。
- 不提交任何密钥，也不提交内部数据（任务、成员名单、会议内容）。`.env`、`.env*.local` 和 `tasks.local.json` 已被忽略。
- 上游的约定（命名、数据库迁移、i18n）见 [AGENTS.md](AGENTS.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 同步上游

```bash
git fetch upstream main
git merge upstream/main
pnpm install
pnpm db:migrate
pnpm --filter @kan/hub migrate
pnpm --filter @kan/hub check-seams
```

冲突只应该出现在登记过的接缝文件里。

`upstream` 的 push 地址已被禁用，不会误推到 Kan 官方仓库。

## 许可

Kan 采用 AGPL-3.0，这个 fork 也必须是。含义很具体：**只要有人通过网络使用我们部署的 Hub，我们就得向他们提供对应的源代码**，包括我们的修改。最简单的做法是把仓库设为公开。不能把它改成闭源产品。
