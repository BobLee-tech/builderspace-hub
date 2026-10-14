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

  admin: {
    title: "后台",
    entry: "后台",
    backToApp: "返回工作台",
    denied: {
      heading: "没有后台权限",
      body: "后台只对后台管理员开放。如果你需要进入，请联系所有者。",
    },
    loading: "加载中…",
    groups: { overview: "概览", people: "成员与准入", system: "系统管理" },
    roles: { owner: "所有者", admin: "管理员", viewer: "只读", none: "无" },
    projectRoles: {
      admin: "管理员",
      member: "成员",
      guest: "访客（只读）",
      none: "不在项目里",
    },
    statuses: { active: "正常", suspended: "已停用" },
    grantStates: {
      pending: "待使用",
      consumed: "已使用",
      expired: "已过期",
      revoked: "已撤销",
    },
    pagination: { previous: "上一页", next: "下一页" },
    confirm: "确认",
    cancel: "取消",
    copy: "复制",
    copied: "已复制",
    oneTime: "只显示这一次。关掉之后无法再查看，请现在复制并私下发给本人。",
    overview: {
      title: "总览",
      description: "后台的入口。账号、项目和待使用的注册链接的数量一目了然。",
      accounts: "账号",
      projects: "项目",
      openGrants: "待使用的注册链接",
    },
    accounts: {
      title: "账号",
      description:
        "所有能登录 Hub 的人。管理员可以直接添加账号、重置密码、停用账号，以及调整每个人在各项目里的角色。",
      search: "按称呼或邮箱搜索",
      add: "添加账号",
      columns: {
        name: "称呼 / 邮箱",
        role: "后台角色",
        projects: "所在项目",
        status: "状态",
        createdAt: "加入时间",
      },
      empty: "没有匹配的账号",
      noProjects: "暂无",
      form: {
        heading: "添加账号",
        hint: "系统会生成一个临时密码，只显示一次；对方登录后可以在「设置」里改成自己的密码。",
        name: "称呼",
        email: "邮箱",
        hubRole: "后台角色",
        projects: "加入项目",
        submit: "添加",
        created: "账号已添加。临时密码：",
      },
    },
    account: {
      back: "返回账号列表",
      description:
        "一个账号的详细情况。危险操作都需要点两次确认，所有改动都会写进操作日志。",
      facts: {
        email: "邮箱",
        role: "后台角色",
        status: "状态",
        createdAt: "加入时间",
      },
      rename: "修改称呼",
      save: "保存",
      roleHeading: "后台角色",
      roleHint: "只有所有者能任命或撤销后台成员。不能修改自己的角色。",
      projectsHeading: "项目角色",
      projectsHint: "在这里把人加入项目、调整角色或移出项目。访客只能查看。",
      passwordHeading: "重置密码",
      passwordHint:
        "生成一个新的临时密码并让这个账号在所有设备上退出登录。原密码立即失效。",
      passwordAction: "重置密码",
      passwordDone: "新的临时密码：",
      dangerHeading: "停用账号",
      suspendHint:
        "停用后这个账号立即退出登录、无法再登录，它的 API key 也会失效。数据不会删除，随时可以恢复。",
      suspend: "停用账号",
      restoreHint: "恢复后这个账号可以重新登录。原来的 API key 不会恢复。",
      restore: "恢复账号",
      notFound: "找不到这个账号。",
    },
    grants: {
      title: "注册链接",
      description:
        "Hub 不开放公开注册。在这里为一个邮箱生成一次性注册链接（7 天有效，只能用一次），私下发给本人；对方注册后自动加入预设的项目。",
      issue: "生成注册链接",
      email: "邮箱",
      hubRole: "后台角色",
      note: "备注（可选）",
      projects: "预设项目",
      submit: "生成",
      issued: "注册链接：",
      columns: {
        email: "邮箱",
        projects: "预设项目",
        state: "状态",
        createdAt: "生成时间",
        expiresAt: "有效期至",
      },
      revoke: "撤销",
      empty: "还没有生成过注册链接",
    },
    audit: {
      title: "操作日志",
      description:
        "后台和命令行里每一次改动的记录：谁、什么时候、对谁、做了什么。",
      columns: { at: "时间", actor: "操作人", summary: "操作" },
      empty: "还没有任何记录",
    },
  },
} as const;

export type HubCopy = typeof zh;

/** The copy pages should use. One language for now. */
export const copy: HubCopy = zh;
