# 安全说明 / Security Policy

BuilderSpace Hub 是一个团队内部管理工具，代码公开，数据不公开。这份文档说明如何报告漏洞、我们怎样保护这个仓库，以及自己部署时要注意什么。

_English summary at the end._

## 报告漏洞

**请不要在公开的 Issue、讨论区或 PR 里描述漏洞。**

请通过 GitHub 的私下漏洞报告提交：仓库页面 → **Security** → **Report a vulnerability**（[直接打开](https://github.com/EdwinjJ1/builderspace-hub/security/advisories/new)）。只有维护者能看到。

报告里最好包括：

- 影响什么：哪个页面、接口或命令，需要什么身份（未登录、普通成员、后台管理员……）；
- 怎么复现：步骤、请求示例；
- 你认为的影响：能读到什么、能改什么。

我们会在 3 个工作日内回复确认，修复后在发布说明里致谢（如果你愿意）。在修复发布之前，请不要公开细节。

**测试请用你自己部署的实例**（[本地运行说明](BUILDERSPACE.md)）。不要对线上实例做压力测试、暴力尝试，也不要读取或修改不属于你的数据。善意、按上面方式报告的研究，我们不会追究。

如果问题出在 Kan 本身（不是我们新增的代码），也请告诉我们；我们会和 Kan 上游协调。

## 范围

重点关注：

- 注册闸门：没有注册链接能否注册、能否抢注别人的邮箱；
- 登录与会话：限流、停用账号、API key；
- 后台权限：普通成员能否进入后台、管理员能否越权任命所有者；
- 项目权限：能否看到或修改自己不在的项目的任务；
- 密钥和数据是否可能进入仓库或日志。

## 我们怎样保护这个仓库

| 措施                                         | 作用                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GitHub 密钥扫描 + 推送拦截                   | 推送里带密钥时直接拒收                                                                        |
| gitleaks（`.github/workflows/security.yml`） | 每个 PR、每次合并、每周全量再扫一次提交历史                                                   |
| Dependabot                                   | 依赖出现安全公告时自动提修复 PR；每月批量升级                                                 |
| CodeQL                                       | 静态代码扫描                                                                                  |
| 主分支保护                                   | 只能经 PR 合并，CI 必须通过；登录、注册、权限相关代码必须由维护者审核（`.github/CODEOWNERS`） |
| 不进仓库的东西                               | 数据库、成员和任务数据、密钥都只在部署环境里；`.env*` 和 `*.local.json` 被忽略                |

## 已有的安全设计

- **注册只能凭一次性链接**：令牌只存 SHA-256；令牌放在链接的 `#` 后面和请求头里，不进服务器日志，也不作为 tRPC 入参（Kan 的日志会记录入参）。详见 [docs/hub/ARCHITECTURE.md](docs/hub/ARCHITECTURE.md)。
- **登录限流**：Better Auth 的限流计数存在数据库里（`hub_rate_limit` 表），所有服务器实例共用，不会因为部署在多个无服务器实例上而被绕过。邮箱密码登录每个 IP 每分钟 5 次，注册每 10 分钟 5 次，申请重置密码每 10 分钟 3 次；其余登录相关路径沿用 Better Auth 默认的每 10 秒 3 次。注册链接检查接口每个 IP 每分钟 30 次。
- **停用账号**立即生效：拒绝新会话、删除现有会话、禁用 API key。
- **后台**只接受浏览器会话，不接受 API key；所有改动写入操作日志。

## 自己部署时

- **反向代理必须改写 `X-Forwarded-For`**。限流按客户端 IP 计数，取的是这个请求头的第一个地址。Vercel 会用真实客户端地址覆盖它；如果你的代理把客户端传来的值原样转发，攻击者就能伪造 IP 绕过限流。
- **不要在生产环境设置 `DISABLE_RATE_LIMIT=true`**，它会关掉全部登录限流。
- **不要设置 `NEXT_PUBLIC_DISABLE_SIGN_UP=true`**：它和注册闸门叠加后，注册链接也会失效。
- `BETTER_AUTH_SECRET` 用足够长的随机值，只放在部署平台的环境变量里。
- 部署后先执行 Hub 迁移（`pnpm --filter @kan/hub migrate`），再用 `pnpm --filter @kan/hub cli doctor` 确认。

---

## English summary

- **Report vulnerabilities privately** via GitHub: **Security → Report a vulnerability** ([link](https://github.com/EdwinjJ1/builderspace-hub/security/advisories/new)). Do not open public issues. We acknowledge within 3 business days. Test against your own instance only; good-faith research reported this way is welcome.
- The repository is protected by GitHub secret scanning with push protection, gitleaks in CI, Dependabot, CodeQL, branch protection on `main` and CODEOWNERS review for authentication, registration and permission code.
- Sign-in rate limits are stored in the database so they hold across serverless instances. Self-hosters must run behind a proxy that overwrites `X-Forwarded-For`, and must not set `DISABLE_RATE_LIMIT=true` in production.
