# 上游接缝

我们改过的 Kan 文件全部列在这里。机器可读的版本是 [`packages/hub/seams.json`](../../packages/hub/seams.json)，两处要保持一致。

检查命令（需要先 `git fetch upstream main`）：

```bash
pnpm --filter @kan/hub check-seams
```

它在三种情况下报错或提醒：清单之外的上游文件被改了；某个接缝文件里约定的标记不见了（比如同步上游时把我们那一行冲掉了）；被我们替换掉的上游组件在上游发生了变化。

## 接缝

| 文件                                         | 改了什么                                              | 标记                 | 为什么                                                                   |
| -------------------------------------------- | ----------------------------------------------------- | -------------------- | ------------------------------------------------------------------------ |
| `packages/auth/src/auth.ts`                  | `plugins` 末尾加上 `hubAuthPlugin(db)`，多一行 import | `hub-seam`           | 注册闸门                                                                 |
| `packages/auth/package.json`                 | 依赖里加 `@kan/hub`                                   | `"@kan/hub"`         | 插件要调用 Hub 的准入规则                                                |
| `apps/web/package.json`                      | 依赖里加 `@kan/hub`                                   | `"@kan/hub"`         | 页面和 API 路由要调用 Hub 的用例                                         |
| `apps/web/src/pages/login/index.tsx`         | 改为渲染 `hub/features/auth/LoginPage`                | `hub-seam`           | 我们自己的登录页；顺带校验 `?next=`，只接受站内路径                      |
| `apps/web/src/pages/signup/index.tsx`        | 改为渲染 `hub/features/auth/InviteOnlyPage`           | `hub-seam`           | 注册只能通过邀请链接                                                     |
| `apps/web/src/components/SideNavigation.tsx` | 左上角的产品名改为 `copy.brand`，多一行 import        | `hub-seam`           | 去掉 Kan 的名字；第 5 期整个侧边栏换成我们自己的组件后，这处接缝随之撤销 |
| `pnpm-lock.yaml`                             | 由 pnpm 重新生成                                      | （生成文件，无标记） | 依赖变化                                                                 |

## 替身

这些上游组件我们不再渲染，由自己的组件接管。上游的文件原样留着不动；`seams.json` 记着我们上次对照时它的 git 哈希，上游改了会有提醒。

| 上游组件                                   | 我们的替身                                          |
| ------------------------------------------ | --------------------------------------------------- |
| `apps/web/src/views/auth/login/index.tsx`  | `apps/web/src/hub/features/auth/LoginPage.tsx`      |
| `apps/web/src/views/auth/signup/index.tsx` | `apps/web/src/hub/features/auth/InviteOnlyPage.tsx` |

## 新增一处接缝

先想能不能不改上游：新页面、新接口、新表都可以是新文件。确实要改时：

1. 改动控制在一两行，逻辑放进我们自己的文件，上游文件里只留调用。
2. 在改动处加注释 `hub-seam: <一句话原因>`（JSON 文件没法加注释，用依赖名之类必然存在的文本当标记）。
3. 在 `packages/hub/seams.json` 和上面的表里各登记一条。
4. 在 PR 描述里说明为什么非改不可。

## 同步上游

```bash
git fetch upstream main
git merge upstream/main
pnpm install
pnpm db:migrate                      # Kan 的迁移
pnpm --filter @kan/hub migrate       # Hub 的迁移
pnpm --filter @kan/hub check-seams
pnpm test
```

冲突只应该出现在上表列出的文件里。`check-seams` 如果提醒某个替身对应的上游组件变了，对照上游的改动决定替身要不要跟进，然后把 `seams.json` 里的 `upstreamSha` 更新为提示里的新值。
