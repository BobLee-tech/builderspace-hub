# Hub 架构

BuilderSpace Hub 是 [Kan](https://github.com/kanbn/kan) 的一个 fork。看板、卡片、工作区、成员角色来自 Kan；准入注册、后台、首页这些是我们加的。这份文档讲我们的代码怎么放、为什么这么放。新增功能的步骤见 [CONTRIBUTING.md](CONTRIBUTING.md)，改了哪些上游文件见 [UPSTREAM_SEAMS.md](UPSTREAM_SEAMS.md)，接下来做什么见 [ROADMAP.md](ROADMAP.md)。

## 一条规则

**我们的代码放在我们自己的目录里；上游文件只在登记过的「接缝」处改一两行。**

这样同步上游时冲突只可能出现在少数几个已知位置，新人也能一眼分清哪些是我们写的。`pnpm --filter @kan/hub check-seams` 会检查这条规则，CI 里每次都跑。

## 代码在哪

| 位置                                         | 放什么                                                                                              | 依赖                     |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------ |
| `packages/hub`                               | 领域逻辑和数据：表定义、迁移、规则、用例、运维命令行                                                | `@kan/db`、`@kan/shared` |
| `packages/auth/src/hub-plugin.ts`            | Better Auth 插件：注册闸门                                                                          | `@kan/hub`               |
| `packages/api/src/routers/hub/`（第 2 期起） | 薄接口层：校验入参 → 调用例 → 映射错误                                                              | `@kan/hub`               |
| `apps/web/src/hub/`                          | 我们的页面：`features/` 按功能分，`ui/` 通用小组件，`copy/` 文案，`lib/` 纯工具，`server/` 仅服务端 | `@kan/hub/public`        |
| `apps/web/src/pages/` 下的新文件             | 只有几行的页面入口，渲染 `hub/features` 里的视图                                                    |                          |

`packages/hub` 不能依赖 `@kan/auth` 或 `@kan/api`，否则会形成循环依赖。这也是接口层放在 `packages/api` 内部而不是独立成包的原因。

## `packages/hub` 内部的分层

每个功能一个文件夹（`access/`、`audit/`…），里面固定四种文件：

| 文件           | 职责                                               | 测试方式               |
| -------------- | -------------------------------------------------- | ---------------------- |
| `*.policy.ts`  | 纯规则，不碰数据库。例如「这条许可现在能不能用」   | 单元测试               |
| `*.repo.ts`    | 只写 SQL。第一个参数是 `db` 或事务 `tx`            | 通过用例的集成测试覆盖 |
| `*.service.ts` | 一个用例一个函数：校验入参、开一个事务、写操作日志 | 内存 Postgres 集成测试 |
| `index.ts`     | 这个功能对外暴露什么                               |                        |

另外两个特殊文件夹：

- `kan/*.gateway.ts`：**唯一**允许调用 Kan 的 repository 的地方。上游改了函数签名，只需要改这里。gateway 可以在上游没有合适函数时只读地查 Kan 的表，但从不直接写。
- `shared/`：邮箱规范化、令牌、错误类型。

`@kan/hub/public` 是唯一可以在浏览器里引用的入口，只有常量和纯函数。

## 数据库：独立的迁移流水

Hub 的表都以 `hub_` 开头，定义在 `packages/hub/src/schema/`，迁移文件在 `packages/hub/migrations/`，迁移记录写在 `drizzle.__hub_migrations`。Kan 的迁移照旧在 `packages/db/migrations/`，记录在 `drizzle.__drizzle_migrations`。

为什么不共用：Drizzle 只执行比「最后一次已执行迁移」时间更晚的条目。如果我们的迁移混在 Kan 的目录里，同步上游后，上游那些时间戳早于我们最新迁移的条目会被静默跳过。两条流水互不干扰就没有这个问题。

几条约定：

- 表的外键可以指向 Kan 的表（`user`、`workspace`…），但 `schema/` 里不要重新导出 Kan 的表，否则它们会进我们的迁移快照。
- 枚举用 `text` + `CHECK`，不用 `pgEnum`：Kan 已经占用了名为 `role` 的 Postgres 枚举。
- 生成迁移：`pnpm --filter @kan/hub generate --name <名字>`。执行：`pnpm --filter @kan/hub migrate`。
- 两个人同时生成迁移时，后合并的那个要重新生成，保证时间戳递增（有测试检查）。

## 注册闸门

没有注册许可的人注册不了。流程：

```
管理员发放许可（后台或命令行）
  → 生成一次性链接  https://<域名>/join#<令牌>   （库里只存令牌的 SHA-256）
  → 管理员私下发给本人
  → 本人打开链接，页面把令牌放在请求头 x-hub-grant 里
      → GET /api/hub/join-status    返回这条链接是否有效、对应哪个邮箱
      → POST /api/auth/sign-up/email 注册
          → hubAuthPlugin 的 user.create.before：令牌有效且邮箱一致才放行
          → user.create.after：provisionUser() 把账号加进预设项目，许可标记为已使用
```

几个容易踩的点，都是有意的设计：

- **令牌放在 `#` 后面和请求头里**，不出现在任何发给服务器的 URL 中，所以不会进访问日志。也**绝不作为 tRPC 入参**：Kan 的 tRPC 日志中间件会原样记录入参。
- **只登记邮箱是不够的**：Kan 的密码注册不验证邮箱归属，知道邮箱的人都能抢注。所以必须持有令牌。
- **插件钩子先于 Kan 自己的钩子执行**，任一返回 `false` 即拒绝，对所有注册方式都生效。
- **`provisionUser()` 是幂等的，after 钩子从不抛错**：Better Auth 在这一步没有事务，用户行已经提交，抛错会留下一个既不能完成也不能重试的账号。失败了只记日志，下次调用会补完。
- **不要设置 `NEXT_PUBLIC_DISABLE_SIGN_UP=true`**：它是 Kan 自己的开关，和我们的闸门是「与」的关系，打开后光有注册链接也会被拒。

### 录取后自动发链接

后台 → 官网 → 志愿者申请里，所有者或管理员把一份申请改成「已录取」时，`site/site.onboarding.ts` 接着做三件事：给申请里的邮箱发一条注册许可（来源记为 `application`，预设加入「BuilderSpace 社团」项目、成员角色），用 Resend 把带链接的欢迎邮件发出去，再写一条 `grant.mailed` 日志。卡片上的「发注册链接 / 重发注册链接」做同一件事，但会替换还有效的旧链接。

- **链接只活在邮件里。** 发信服务明确拒绝（4xx），许可当场撤销，不会留下一条谁都拿不到、却还能用的链接。没有得到明确结果（超时、断线、Resend 自己出错）时，先用同一个幂等键重试一次（第一次若其实已经发出，Resend 只回结果、不会再发）；仍然没有结果就**保留**链接，因为邮件可能已经到了对方手里，作废会让那封邮件里的链接失效。页面提示「可能已经发出」，没收到就点「重发」，日志记 `grant.mail_unconfirmed`。点「重发」时如果新邮件被明确拒绝，作废的是新链接，对方手里那条旧链接会恢复（`grant.restored`），不会因为一次失败的重发连旧链接也丢了。
- **录取先落地，再发信。** 发信失败不撤销录取，页面上给出原因，可以点按钮重试。
- **不会重复发。** 已经有账号的不发；还有没过期的链接时，改成「已录取」不发，要发新的就点「重发」。只有从别的状态改成「已录取」才会触发，重复保存不会。
- **谁能发。** 发许可本来就要 `access.manage`（所有者、管理员）。只有「名单」权限、没有后台角色的人改成「已录取」，录取照常生效，但不发链接，页面提示要管理员来发。
- **发信用 Hub 自己的变量。** `mail/` 只认 `HUB_RESEND_API_KEY`（以及可选的 `HUB_MAIL_FROM`、`HUB_MAIL_REPLY_TO`）。Kan 读的是 `SMTP_*` 和 `EMAIL_FROM`，设了会打开 Kan 自己的邀请和魔法链接邮件，绕过注册闸门，所以不用那几个名字。没设 key 时什么都不发，页面说明原因。
- **在 Supabase 表格里直接改状态不会触发**，因为那不经过 Hub。

## 首页与大看板

`packages/hub/src/tasks/` 负责首页（`/home`）和跨项目大看板（`/tasks/<视图>`）。两者都有一个「范围」：「全部」或某一个项目，写在 URL 的 `?project=` 里。

- **谁能看到哪个项目**只有一个出口：`kan/tasks.gateway.ts` 的 `listViewableProjects()`。条件是正式成员（不是待接受的邀请、没被移除），并且按 Kan 自己的规则算出的有效权限（角色加个人覆盖）同时包含 `board:view` 和 `card:view`。「全部」就是这些项目的合集，别的项目在切换条、计数、看板里都不出现。问一个自己不在的项目，和问一个不存在的项目，得到的回答一样（`NOT_FOUND`）。
- **阶段和职能按名字识别**（`task.policy.ts`）：列名对上「待办 / 进行中 / 待验收 / 已完成」（以及 Kan 模板的英文列名）就进对应的列，对不上的进「其他」；看板名对上「开发 / 运营 / 营销」就算对应职能。标准名字只在 `@kan/builderspace/structure` 里写一次。
- **切换项目在首页做**。侧栏顶部的 `HubSidebarTop` 替换了 Kan 的 `WorkspaceMenu`，只显示当前项目（点击回首页），保留搜索和 ⌘K。Kan 把「当前项目」存在浏览器里，看板页和卡片页都读它，所以首页选中某个项目时会同步过去（`useFollowScope`），从「全部」打开别的项目的卡片前也会先切换（`useOpenInProject`）。
- **首页即总版**：首页的分类卡片和「我负责的任务」下面，直接嵌入当前范围的总版（`TaskBoardBody`，和 `/tasks/all` 是同一个组件、同一份数据），可以就地编辑。
- **总版**：某个项目的「全部」视图就是这个项目的总版，Kan 的看板页上第一块就是它的入口（`OverallBoardTile`）。总版里的卡片按职能着色；有编辑权限的人可以把任务拖到另一列、改截止日期、新建任务（选放到哪个职能、哪一列，可勾「指派给我」）。这些操作都直接调用 Kan 自己的 `card.update` / `card.create`：卡片本来就是小看板上的那一张，所以小看板、首页「我负责的任务」立即同步，Kan 也照常校验权限、写卡片活动记录。拖动时按目标看板里对应阶段的列来移，没有那一列就提示，不会移到别的看板。
- **职能颜色**存在 `hub_setting` 表（`settings/`），后台「职能颜色」页修改，所有登录的人都能读；读到的值不合法时按职能退回默认色。

## 项目权限与「没权限就不显示」

- **数据只有一份**：成员和访客能做什么，存在 Kan 自己的角色权限表里。后台「项目权限」页（`packages/hub/src/permissions/`）读写的就是这张表，所以 Kan 的页面、接口和我们的首页都立即跟着变。项目管理员的权限固定为全部；删除项目和管理计费只给管理员，和 Kan 一致。
- **Kan 不知道的规则**由 Hub 固定：新建项目只有后台管理员（`guards.ts` 的 `assertCanCreateProject`），新建模板只有项目管理员（`assertCanCreateTemplate`）。
- **界面上没权限就不显示**：Kan 的视图通过 `useHubPermissions()`（Kan 的 `usePermissions` 加上 Hub 的规则）拿权限；原来没权限时灰掉的按钮加了 `hidden`，全局样式保证 `hidden` 一定生效；侧栏链接先经 `useHubNavFilter()` 过滤。服务端照样各自校验，界面只是不再展示做不了的事。

## 限流

登录、注册和注册链接检查都有按 IP 的限流，计数存在 `hub_rate_limit` 表里（`packages/hub/src/rate-limit/`）。放在数据库而不是内存，是因为线上跑在多个无服务器实例上，各自在内存里计数等于没有限制。

- Better Auth 自带限流逻辑，`hubAuthPlugin` 给它换上数据库存储（`rateLimitStorage`），并对邮箱密码登录、注册、申请重置密码加了更严的规则（`HUB_AUTH_RATE_LIMITS`）。插件的选项只填补 Kan 没设置的项，所以 `DISABLE_RATE_LIMIT` 仍然有效（测试里就用它关掉）。
- Better Auth 的计数是「先读再写」两步，并发请求会读到同一个旧值、一起放行。所以这三类路径在插件的 `onRequest` 里另用 `consumeRateLimit` 原子计数一次（key 以 `hub-auth:` 开头），并发打进来也只放行规定的次数；Better Auth 自己那层照常保留。
- 两层在数据库出错时都放行（不因为数据库抖动把人挡在门外），但都会记错误日志（`Sign-in rate limit check failed`、`Rate limit storage failed`）。
- Hub 自己的 API 路由用 `withHubRateLimit`（`apps/web/src/hub/server/rate-limit.ts`），背后是一条原子的 `INSERT … ON CONFLICT` 语句，并发请求也不会多放行；`DISABLE_RATE_LIMIT=true` 时同样关闭。
- 计数按 `X-Forwarded-For` 的第一个地址算，自己部署时代理必须改写这个头，见根目录的 [SECURITY.md](../../SECURITY.md)。

## 个人日程

`packages/hub/src/schedule/` 负责 `/me`（个人）：一个人自己的一周，有空、没空、会议，以及排给任务的时间。

- **一张表**：`hub_time_block`，每行是一段属于某个人的时间（起止、类型、标题）。`task` 类型的块只存关联的卡片，**标题和状态每次都从卡片读**，所以看板里改名、完成，日程立刻跟着变，不会各存一份、慢慢对不上。
- **任务从哪来**：`tasks/task.service.ts` 的 `getMyTasks()`，也就是首页「指派给我的」同一套规则（我能看的项目里、指派给我的卡片）。被取消指派、离开项目、卡片被删，对应的块从日程里隐藏但不删除，重新指派后会回来。
- **只有本人能看**：每个用例都以 `userId` 为界，查别人的块得到的回答和查不存在的一样（`NOT_FOUND`）。
- **不写操作日志**：这是对「每个改数据的用例都要有操作日志」的有意例外。操作日志后台管理员能看，而一个人的日程不该被管理员读到；日志里哪怕只记「改了一个标题」也会泄露内容。测试里有一条断言保证这点。
- **时间**：库里存绝对时刻（UTC），哪一天、几点由浏览器的时钟决定。页面的格子换算在 `apps/web/src/hub/lib/schedule-layout.ts`，是不依赖 React 的纯函数，测试在三个时区下都跑过。
- **交互**：先选一种「画笔」（没空 / 有空 / 会议，或者点右边的一个任务），再在时间表上拖。点一下是一小时；拖块移动，拖块的下沿缩放。

## 文档库

`packages/hub/src/documents/` 负责 `/documents`：用 Markdown 或 HTML 在页面里写和编辑的文档。**不存附件，不用对象存储。**

- **内容在数据库里。** 表：`hub_document`（标题、文件名、大小、`storageKey`、可读开关）、`hub_document_blob`（内容本身，按 `storageKey` 存，最大 400 KB）、`hub_document_folder`（文件夹，可嵌套，最多 3 层）、`hub_document_editor`（谁被指派可以改哪份文档）、`hub_document_edit_request`（申请记录）。`DocumentStorage` 接口只剩一个实现 `storage.db.ts`；接口保留是为了让内容存放的位置和业务规则分开，测试里另有一个内存实现。
- **历史：** 文档库最早做过文件上传（浏览器直传 S3 兼容存储，PDF、PPT 等），后来决定不需要附件，整条路删掉了：上传分两步的用例、S3 和磁盘存储、上传路由、导入命令。迁移历史不改写：`hub_document_upload` 表留着（表里没有数据，代码不再读写它），要彻底去掉得另写一条迁移。`hub_document.storageKey` 仍在用：它是内容在 `hub_document_blob` 里的键。线上从没配过 bucket，所以没有需要搬走的文件。
- **权限规则全在 `document.policy.ts`**，界面和接口都不另写。读：登录成员，除非这份文档的可读开关被关掉（关掉后只有能修改的人看得到）。新建：所有者、管理员（`documents.manage`）。修改：所有者，或被指派的人；管理员不是所有文档的编辑者。指派和处理申请：所有者，和自己是编辑者的管理员；被指派的普通成员不能再往下指派。读不到的文档和不存在的文档，回答一样（`NOT_FOUND`）。
- **上传 = 在浏览器里把文件变成文本。** `file-import.ts` 读 `.md` / `.markdown` / `.html` / `.htm`（必须是 UTF-8），把 Word（`.docx`）用 mammoth 转 HTML、再用 turndown 转 Markdown：表格的第一行当表头，图片去掉并计数。结果填进「新建文档」对话框，人看过再保存，走的还是 `createText`，服务端没有上传接口。转换放在浏览器，是因为带图的 `.docx` 很容易超过 tRPC 1 MB 的请求上限；转换库只在选了文件时才加载（`import()`），`IMPORT_ACCEPT` 在 `@kan/hub/public` 里，页面不用为了它加载转换库。
- **格式白名单，类型由我们定。** 只认扩展名 `.md`、`.html`、`.htm`（`inspectFile`），不信客户端报的类型。读的时候返回的类型也由我们定：Markdown 经文件接口一律按纯文本输出，从不解释。
- **渲染：** Markdown 在页面里用 react-markdown 加 remark-gfm 渲染（支持 GitHub 的表格、任务列表、删除线；不解释原始 HTML，去掉危险的链接地址），不需要沙箱。HTML 是唯一能带代码的格式，只在沙箱里显示：`<iframe sandbox="allow-scripts …">` 没有 `allow-same-origin`，页面被当作来自「无处」，能跑脚本，但读不到本站的 cookie、存储和接口；文件接口的响应头再加一道 `Content-Security-Policy: sandbox`，直接打开链接也一样。
- **读内容有两个出口：** 页面里的 `hub.documents.content`（tRPC，给编辑器和 Markdown 渲染），和 `GET /api/hub/documents/<id>/file`（给 HTML 的 iframe 和「下载」）。两者都先检查登录状态和权限，不缓存（读的权利可以被收回），文件接口不接受 API key。
- **写内容** 都走 `text.service.ts`：页面里的「新建文档」「编辑内容」和命令行的 `bshub doc`。保存时带上打开时的 `updatedAt`，别人在此之后改过就拒绝，不会悄悄覆盖。上限 400 KB（页面里写的内容要经过 Kan 的 tRPC 路由，请求体上限 1 MB，转义后会变大）。
- **给命令行的 REST 接口** `GET/POST /api/hub/v1/documents…`（`documents/rest.ts` 只管路由和参数，不含任何权限规则；`pages/api/hub/v1/documents/[[...path]].ts` 管 HTTP）。**只认 API key**，不认浏览器会话：cookie 会随别的网页发出的请求一起带上，而这套接口不需要它；查 key 之前先去掉 cookie 头。**刻意不提供**删除文档和删除文件夹、指派/收回/处理修改权限：API key 现在没有权限范围，泄露后不应该能删文档或转让编辑权，这些只在网页里做。读不到的文档回 404，和不存在一样。
- **每个改数据的用例都有操作日志。**
- **已知的局限**：没有版本历史（保存会覆盖旧内容）；只有 Markdown 和 HTML，没有附件；还没加入项目的成员被 Kan 的外壳重定向到首页，看不到文档。

## 操作日志

每个会改数据的用例都用 `withAudit()` 包起来：改动和日志在同一个事务里，要么都写要么都不写。日志存操作人邮箱的副本（账号删了也能查）、动作名、对象类型和 ID、一句人能读的摘要。新增动作时在 `audit/audit.ts` 的 `AuditAction` 里加一项。

## 测试

- 纯规则：普通单元测试。
- 用例和 gateway：`createHubTestDb()` 起一个内存 Postgres（PGlite），先跑 Kan 的迁移再跑我们的，每个测试一个全新的库。官网后台的用例另外用 `createSiteTestDb()` 起一个只有官网那几张表的内存库。
- 注册闸门：`packages/auth/src/hub-plugin.integration.test.ts` 用 Kan 真实的 Better Auth 配置跑在内存库上，走 HTTP 接口。升级 Better Auth 时它会第一个告诉你钩子的行为变没变。
- 覆盖率门槛 80%，范围是 `packages/hub`。界面的关键流程之后用 Playwright 覆盖。
