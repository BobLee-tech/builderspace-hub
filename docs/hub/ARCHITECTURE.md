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

## 操作日志

每个会改数据的用例都用 `withAudit()` 包起来：改动和日志在同一个事务里，要么都写要么都不写。日志存操作人邮箱的副本（账号删了也能查）、动作名、对象类型和 ID、一句人能读的摘要。新增动作时在 `audit/audit.ts` 的 `AuditAction` 里加一项。

## 测试

- 纯规则：普通单元测试。
- 用例和 gateway：`createHubTestDb()` 起一个内存 Postgres（PGlite），先跑 Kan 的迁移再跑我们的，每个测试一个全新的库。
- 注册闸门：`packages/auth/src/hub-plugin.integration.test.ts` 用 Kan 真实的 Better Auth 配置跑在内存库上，走 HTTP 接口。升级 Better Auth 时它会第一个告诉你钩子的行为变没变。
- 覆盖率门槛 80%，范围是 `packages/hub`。界面的关键流程之后用 Playwright 覆盖。
