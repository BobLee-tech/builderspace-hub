/**
 * Every sentence the Hub's own pages show, in Chinese.
 *
 * Pages read text from here instead of writing it inline, so wording stays
 * consistent and a second language can be added later as another object of
 * the same shape (the `HubCopy` type makes the compiler check it is complete).
 */
export const zh = {
  brand: "BuilderSpace Hub",

  auth: {
    login: {
      title: "登录",
      heading: "欢迎回来",
      noAccount: "还没有账号？注册需要邀请链接。",
      learnMore: "了解如何加入",
    },
    inviteOnly: {
      title: "仅限受邀",
      heading: "注册需要邀请链接",
      body: "BuilderSpace Hub 是内部工具，不开放公开注册。管理员为你开通后会私下发给你一条注册链接，打开那条链接就能设置账号。",
      haveAccount: "已经有账号？",
      login: "去登录",
    },
    join: {
      title: "加入",
      heading: "设置你的账号",
      loading: "正在核对注册链接…",
      emailLabel: "邮箱",
      emailHint: "这条链接只为这个邮箱开通，不能更改。",
      nameLabel: "称呼",
      namePlaceholder: "大家怎么称呼你",
      passwordLabel: "密码",
      passwordPlaceholder: "至少 8 位",
      submit: "完成注册",
      nameRequired: "请填写称呼。",
      passwordTooShort: "密码至少 8 位。",
      passwordTooLong: "密码最多 128 位。",
      failed:
        "注册没有成功。链接可能已经失效，或者这个邮箱已经注册过了。请联系给你链接的管理员。",
      states: {
        invalid: {
          heading: "这条链接无效",
          body: "请确认链接是完整复制的，或者联系给你链接的管理员重新发一条。",
        },
        expired: {
          heading: "这条链接已过期",
          body: "注册链接 7 天内有效。请联系管理员重新发一条。",
        },
        consumed: {
          heading: "这条链接已使用",
          body: "这个邮箱已经完成注册，可以直接登录。",
        },
        revoked: {
          heading: "这条链接已被撤销",
          body: "管理员撤回了这条链接。如果你认为这是误会，请联系管理员。",
        },
        unreachable: {
          heading: "暂时无法核对链接",
          body: "请稍后刷新重试。",
        },
      },
    },
  },
} as const;

export type HubCopy = typeof zh;

/** The copy pages should use. One language for now. */
export const copy: HubCopy = zh;
