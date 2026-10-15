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

`packages/hub/src/documents/` 负责 `/documents`：合同、方案、PPT 这类文件的在线管理。

- **库里只有元数据，文件在对象存储里。** 表：`hub_document`（标题、文件名、大小、`storageKey`、可读开关）、`hub_document_folder`（文件夹，可嵌套，最多 3 层）、`hub_document_editor`（谁被指派可以改哪份文档）、`hub_document_edit_request`（申请记录）、`hub_document_upload`（见下）。文件放在 S3 兼容的私有 bucket；本地开发用磁盘上的一个目录顶替（`storage.fs.ts`），生产环境设了会报错。三种实现（S3、磁盘、测试用的内存）都走 `DocumentStorage` 接口。
- **权限规则全在 `document.policy.ts`**，界面和接口都不另写。读：登录成员，除非这份文档的可读开关被关掉（关掉后只有能修改的人看得到）。新建：所有者、管理员（`documents.manage`）。修改：所有者，或被指派的人；管理员不是所有文档的编辑者。指派和处理申请：所有者，和自己是编辑者的管理员；被指派的普通成员不能再往下指派。读不到的文档和不存在的文档，回答一样（`NOT_FOUND`）。
- **上传分两步，文件不经过我们的服务器。** Vercel 函数的请求体限 4.5 MB，PPT 放不下。`prepareUpload` 检查格式和大小，在 `hub_document_upload` 里记一条（谁、哪个 key、多大、30 分钟内有效），返回一个签了名的上传地址；浏览器把文件直接传给 bucket；`completeUpload` 向 bucket 确认文件真的在、大小和签名时一致，再建文档。只有这张表里属于本人、没用过、没过期的 key 才能变成文档——否则任何人都能把别人文件的 key 登记成自己的文档，读到它。签名里带了文件大小，bucket 会拒绝别的长度。
- **格式白名单，类型由我们定。** 只认扩展名（`inspectFile`），不信浏览器报的类型；脚本、可执行文件、SVG 不收。读文件时返回的类型也由我们定：md、csv、json 一律按纯文本显示，从不解释。
- **读文件只有一个出口** `GET /api/hub/documents/<id>/file`：先按登录状态和权限检查，再重定向到几十秒有效的签名链接（磁盘存储时由服务器直接输出）。不缓存，因为读的权利可以被收回。不接受 API key。
- **HTML 是唯一能带代码的格式，只在沙箱里显示。** 页面里的 `<iframe sandbox="allow-scripts …">` 没有 `allow-same-origin`，页面被当作来自「无处」：能跑脚本，但读不到本站的 cookie、存储和接口。磁盘存储下文件由我们自己的域名输出，响应头再加一道 `Content-Security-Policy: sandbox`。PDF 用不带沙箱的 iframe（浏览器的 PDF 阅读器在沙箱里不能用）。
- **每个改数据的用例都有操作日志。** `prepareUpload` 是例外：它没有改任何持久的东西，文档在 `completeUpload` 里才出现并记日志。
- **文本文档可以在网页里写、也可以用命令行写。** md、txt、csv、json、html（`isTextExtension`）不必上传文件：页面里的「新建文档」「编辑内容」和命令行的 `bshub doc`，都走 `text.service.ts`，服务端自己把内容存进 bucket（`DocumentStorage.read` / `put`），规则、格式白名单和操作日志与上传的文档完全一样。上限 400 KB（页面里写的文本要经过 Kan 的 tRPC 路由，请求体上限 1 MB，转义后会变大）。
- **给命令行的 REST 接口** `GET/POST /api/hub/v1/documents…`（`documents/rest.ts` 只管路由和参数，不含任何权限规则；`pages/api/hub/v1/documents/[[...path]].ts` 管 HTTP）。**只认 API key**，不认浏览器会话：cookie 会随别的网页发出的请求一起带上，而这套接口不需要它；查 key 之前先去掉 cookie 头。**刻意不提供**删除文档和删除文件夹、指派/收回/处理修改权限：API key 现在没有权限范围，泄露后不应该能删文件或转让编辑权，这些只在网页里做。可读性规则不变：读不到的文档回 404，和不存在一样。
- **导入命令** `cli import-documents`（`cli/import-documents.ts`）直接读本地目录、写存储和数据库，不走网页；不做权限检查，因为它只能由有数据库访问权的人在命令行运行。HTML 文件会把相对路径引用的样式、字体、图片内联进去（`cli/inline-html.ts`，只读源目录之内的文件）。
- **已知的局限**：没有版本历史（替换文件会删掉旧文件）；Word、PPT、Excel 没有预览（只能下载）；没完成的上传留下的孤儿文件还没有定期清理；还没加入项目的成员被 Kan 的外壳重定向到首页，看不到文档。
## 我完成的

`packages/hub/src/archive/` 负责 `/me/done`：一个人完成过的任务，按月、按项目、按职能统计。

- **不建表**：完成的事实本来就在 Kan 的卡片活动记录里（`card_activity` 的 `card.updated.list`）。只读 `kan/archive.gateway.ts`，所以看板里怎么动，这里就怎么算，不会出现两份对不上的数据。
- **怎样算完成**：卡片现在在「已完成」列（按列名识别，和大看板同一套规则）。完成时间取最后一次移进完成列的记录；直接建在完成列里的卡片取创建时间；什么记录都没有的（比如导入的）取卡片的创建时间，但只算给负责人。任务被重新打开就不再算。
- **算给谁**：有负责人的算给负责人；没有负责人的算给把它移进完成列的人（`archive.policy.ts` 的 `countsForMe`）。只看自己能看的项目，离开了的项目不再出现。
- **月份按看的人的时区切**：页面把浏览器时区传给接口，服务端用 `Intl` 换算，纯函数有测试。
- 和日程一样只有本人能看，只读，不写操作日志。

## 官网后台

`packages/hub/src/site/` 负责后台的「官网」分区（`/admin/site`）：审核官网访客提交的项目卡和项目进展，跟进志愿者申请，查看加入登记。数据不在 Hub 的库里，而在官网自己的 Supabase 库里。

- **两个数据库。** 官网的表定义在 `site/site.tables.ts`，故意放在 `schema/` 外面，drizzle-kit 不会把它们写进 Hub 的迁移；表由官网仓库的迁移创建，这里只列后台用到的列，官网以后加列不影响。连接在 `site/site.db.ts`：读 `HUB_SITE_DATABASE_URL`，每个实例建一个小连接池；没设就是「未连接」。
- **专用角色，最小权限。** Hub 以 `hub_site_admin` 登录官网的库（建角色的迁移在官网仓库）。它只有四张表的 select、审核状态和志愿者状态 / 备注这几列的 update，外加放行这些操作的 RLS 策略。连非本机地址时一律 TLS 校验证书，URL 里的 `sslmode` 会被忽略（node-postgres 会让 URL 覆盖 `ssl` 选项）。
- **官网权限和后台角色无关。** `hub_account.siteAccess`：`people`（名单）或 `manage`（管理），只有所有者能设，可以给自己设。规则在 `site/site.policy.ts` 的 `canOnSite()`；接口层用 `hubSiteProcedure(权限)`，用例里再查一遍。只有官网权限、没有后台角色的人，后台入口直接进 `/admin/site`，侧栏只显示「官网」一组。
- **操作日志跨库。** 改官网数据的用例在写日志的 Hub 事务里执行官网那一步：官网那步失败，什么都不记；只有官网已提交、Hub 随后失败这一种极少见的情况会漏记。日志只写志愿者「改了备注」，不写备注内容；导出名单也记一条，写明筛选条件和条数。
- **出错时。** 官网库连不上或者报错，用例记一条服务端日志，页面只看到「暂时连不上官网数据库」（`UNAVAILABLE` → `SERVICE_UNAVAILABLE`）。
- **已知限制。** 封面和视频存在官网的私有存储里，Hub 没有存储的密钥，审核页只显示「有封面 / 视频时长」，原图和视频看企业微信的推送。志愿者备注是接口入参，会和日程标题一样出现在请求日志里。访客填的链接只有 `http(s)` 才渲染成链接；导出的表格会给 `= + - @` 开头的单元格加 `'`，防止在表格软件里被当成公式执行。

## GitHub

`packages/hub/src/github/` 负责连接 GitHub。分两步上线：先是后台的「项目仓库」，再是个人页的「连接 GitHub」。

- **项目仓库**（`hub_project_repo`）：后台给每个项目配它由哪些仓库组成，存成小写的 `owner/name`（GitHub 不区分大小写，统一写法才能正确判断重复）。粘贴的 GitHub 链接会被规范化（`repo.policy.ts`）。所有者和管理员能改（`settings.manage`），每次改动都写操作日志。
- **一个人的活动只读他能看的项目的仓库**：`listReposForUser()` 用的是和首页同一个出口 `listViewableProjects()`。不在某个项目里的人，那个项目的仓库一个也不会被读取或统计。
- 连接用 **GitHub App**，不用 OAuth App：GitHub App 的权限是只读的，而且只对安装了它的仓库有效；OAuth App 要读私有仓库就得要 `repo` 权限，等于对这个人所有私有仓库都有读写权（2026-10-14 定）。环境变量叫 `HUB_GITHUB_CLIENT_ID` / `HUB_GITHUB_CLIENT_SECRET`，故意不用 `GITHUB_CLIENT_ID`：那是 Kan 自己的变量名，设了就会打开「用 GitHub 登录」，绕过注册闸门。
- **连接**（`/me/github` 的「连接 GitHub」）：`/api/hub/github/connect` 生成随机 `state`，放进只有 `/api/hub/github` 收得到的 HttpOnly cookie，再跳去 GitHub 授权；GitHub 跳回 `/api/hub/github/callback`，`state` 和 cookie 对上（常量时间比较）才去换令牌。这两个是普通 API 路由不是 tRPC，因为要做跳转；`code` 不进 tRPC 日志。
- **令牌加密存**（`hub_github_account`）：AES-256-GCM，密钥用 HKDF 从现有的 `BETTER_AUTH_SECRET` 派生，所以不用多管一个密钥（`token-crypto.ts`）。换了 `BETTER_AUTH_SECRET` 之后旧令牌解不开，大家重新连接一次就行。GitHub App 的用户令牌 8 小时过期，快过期时用 refresh token 自动换新。
- **同步**（「同步最近活动」）：只读 `listReposForUser()` 给的仓库，读最近 90 天的提交（按作者）、自己开的 PR、合并的 PR、自己开的 Issue，每个仓库一页 100 条，一次最多并行读 4 个仓库；结果存进 `hub_github_event`（按「人 + 仓库 + 类型 + 编号」去重）。一分钟最多同步一次。App 没装或没权限的仓库返回 404/403，标成「读不到」，不影响别的仓库；GitHub 不认令牌（401）就提示重新连接，已存的数据不动。
- **展示时再按权限过滤一次**：统计和列表只算现在还能看的项目的仓库，离开项目后那些活动就不再显示（数据还在，重新加入项目会回来）。
- **断开**：请 GitHub 撤销令牌，删掉连接和同步来的活动。连接和断开写操作日志（只有 GitHub 用户名，从不写令牌）；同步本身不写。
- GitHub 的调用都在 `github.client.ts` 后面，用例测试换成假 GitHub，不走网络。

## 操作日志

每个会改数据的用例都用 `withAudit()` 包起来：改动和日志在同一个事务里，要么都写要么都不写。日志存操作人邮箱的副本（账号删了也能查）、动作名、对象类型和 ID、一句人能读的摘要。新增动作时在 `audit/audit.ts` 的 `AuditAction` 里加一项。

## 测试

- 纯规则：普通单元测试。
- 用例和 gateway：`createHubTestDb()` 起一个内存 Postgres（PGlite），先跑 Kan 的迁移再跑我们的，每个测试一个全新的库。官网后台的用例另外用 `createSiteTestDb()` 起一个只有官网那几张表的内存库。
- 注册闸门：`packages/auth/src/hub-plugin.integration.test.ts` 用 Kan 真实的 Better Auth 配置跑在内存库上，走 HTTP 接口。升级 Better Auth 时它会第一个告诉你钩子的行为变没变。
- 覆盖率门槛 80%，范围是 `packages/hub`。界面的关键流程之后用 Playwright 覆盖。
