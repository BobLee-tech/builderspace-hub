# 给 Hub 写代码

先读 [ARCHITECTURE.md](ARCHITECTURE.md)。本地怎么跑起来见仓库根目录的 [BUILDERSPACE.md](../../BUILDERSPACE.md)。

## 常用命令

```bash
pnpm --filter @kan/hub test              # 单元 + 集成测试
pnpm --filter @kan/hub test:coverage     # 带覆盖率，低于 80% 会失败
pnpm --filter @kan/hub typecheck
pnpm --filter @kan/hub lint
pnpm --filter @kan/hub check-seams       # 有没有越界改上游文件
pnpm --filter @kan/hub generate --name AddSomething   # 生成迁移
pnpm --filter @kan/hub migrate           # 执行迁移（读根目录 .env）
pnpm --filter @kan/hub cli help          # 运维命令
pnpm format:fix                          # 提交前格式化
```

## 加一个功能，照这个顺序

以 `packages/hub/src/access/` 为样板。

1. **表**（如果需要）：在 `packages/hub/src/schema/` 加文件，表名以 `hub_` 开头，在 `schema/index.ts` 里导出，然后生成迁移。
2. **规则** `<功能>.policy.ts`：能写成纯函数的判断都放这里。先写测试。
3. **数据访问** `<功能>.repo.ts`：只有 SQL，第一个参数是 `db: DbOrTx`。
4. **用例** `<功能>.service.ts`：一个函数做一件事。入参用 zod 校验；预期内的失败抛 `HubError`（带错误码和给人看的中文消息）；改数据的用 `withAudit()` 包住。先写集成测试。
5. **接口**（第 2 期起）`packages/api/src/routers/hub/<功能>.ts`：只做三件事——校验、调用例、把 `HubError` 映射成接口错误。
6. **页面** `apps/web/src/hub/features/<功能>/`：文案写进 `hub/copy/zh.ts`，不要散落在组件里；页面入口文件放在 `apps/web/src/pages/`，只负责渲染视图。

需要调 Kan 的 repository 时，在 `packages/hub/src/kan/` 里加或改一个 gateway，不要在别处直接 import `@kan/db/repository/*`。

## 必须遵守

- **先写测试。** 纯规则逐条覆盖；用例至少覆盖成功、每种拒绝、以及「拒绝时什么都没改」。
- **每个改数据的用例都要有操作日志**，并有测试断言它。
- **令牌、密码这类秘密绝不作为 tRPC 入参**（会被日志记下来），也不写进操作日志和错误消息。
- **邮箱一律先过 `normalizeEmail()`** 再比较或入库。
- **不提交任何密钥和内部数据**：真实的任务、成员名单、申请内容只存在数据库里。仓库是公开的，文档和提交信息里也不要写成员姓名。
- **不越界改上游文件**，见 [UPSTREAM_SEAMS.md](UPSTREAM_SEAMS.md)。
- 注释写「为什么」，不写「做了什么」；代码能说清的不用注释。

## 提 PR 之前

```bash
pnpm --filter @kan/hub test:coverage && pnpm --filter @kan/hub typecheck && pnpm --filter @kan/hub lint && pnpm --filter @kan/hub check-seams
```

改了页面的，在本地实际点一遍，PR 里说明验证了什么、没验证什么。合并到 `main` 会触发生产部署；如果 PR 带了新的 Hub 迁移，要先对生产库执行迁移再合并。

## 安全

- 登录、注册闸门、权限和数据库迁移相关的目录列在 `.github/CODEOWNERS` 里，改动它们的 PR 需要维护者审核。
- 不要提交任何密钥、`.env` 文件或真实的成员和任务数据。推送时 GitHub 会拦截看起来像密钥的内容，CI 里还有 gitleaks 再查一遍；如果被误报，确认不是密钥后把那一条加进 `.gitleaksignore`（一条一行，写明原因），不要整目录忽略。
- 发现漏洞请按 [SECURITY.md](../../SECURITY.md) 私下报告。

## 用 CLI 做端到端检查

改动了任务、看板、权限或登录相关的代码，提 PR 前用 [CLI 的冒烟测试](https://github.com/EdwinjJ1/builderspace-hub-cli#可以用-cli-测试-hub) 对本地 Hub 跑一遍，见 [BUILDERSPACE.md](../../BUILDERSPACE.md) 的「用 CLI 测试」。
