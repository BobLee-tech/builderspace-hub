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

  nav: {
    home: "首页",
    goHome: "回到首页",
    switchProjectHint: "在首页切换项目",
    search: "搜索",
    openSearch: "打开搜索",
    personal: "个人",
    goPersonal: "打开个人日程",
  },

  home: {
    title: "首页",
    greeting: {
      morning: "早上好",
      afternoon: "下午好",
      evening: "晚上好",
    },
    scope: {
      label: "查看范围",
      all: "全部",
      allHint: "你加入的所有项目",
    },
    projectCount: (count: number) => `你在 ${count} 个项目里`,
    tiles: {
      mine: "指派给我的",
      dueSoon: "即将到期",
      dueSoonHint: (days: number) => `${days} 天内`,
      overdue: "已逾期",
      open: "全部任务",
      openHint: "未完成",
    },
    myTasks: {
      title: "我负责的任务",
      seeAll: "查看全部",
      empty: "现在没有指派给你的任务。",
    },
    openBoards: "打开这个项目的看板",
    overall: {
      title: "总版",
      fullScreen: "全屏打开",
    },
    waiting: {
      heading: "等待分配项目",
      body: "你的账号已经开通，但还没有被加入任何项目。请联系管理员把你加进项目，之后这里就会出现你的任务。",
      create: "新建项目",
    },
    scopeMissing: "没有这个项目，或者你不在这个项目里。",
    scopeMissingBack: "回到全部",
  },

  tasks: {
    views: {
      mine: "指派给我的",
      "due-soon": "即将到期",
      overdue: "已逾期",
      all: "总版",
    },
    overallHint:
      "开发、运营、营销的所有任务都在这里。拖到另一列，或者改截止日期，对应的小看板会同步。",
    backHome: "回到首页",
    otherStage: "其他",
    doneLimited: (shown: number, total: number) =>
      `显示最近 ${shown} 个，共 ${total} 个`,
    emptyColumn: "没有任务",
    emptyBoard: "这里还没有任务。",
    due: {
      overdue: "已逾期",
      today: "今天到期",
    },
    assignedToMe: "我",
    newTask: "新建任务",
    newTaskIn: (stage: string) => `在「${stage}」新建任务`,
    form: {
      title: "任务",
      titlePlaceholder: "要做什么",
      board: "放到",
      stage: "阶段",
      due: "截止日期",
      assignMe: "指派给我",
      create: "新建",
      cancel: "取消",
      titleRequired: "请写上任务内容。",
    },
    move: {
      noList: (board: string, stage: string) =>
        `「${board}」看板没有「${stage}」列，没法移过去。`,
      failed: "没有移动成功，已恢复原样。",
    },
    dueEdit: "改截止日期",
    dueClear: "清除",
    dueFailed: "截止日期没有保存成功。",
    overallTile: {
      title: "总版",
      hint: "所有职能的任务，按颜色区分",
    },
  },

  schedule: {
    title: "个人",
    heading: "我的时间",
    description:
      "标出哪些时间有空、哪些没空、在忙什么。分给你的任务会按截止日出现在对应的那天；把任务排进时间表，这段时间就被它占用了。这里只有你自己能看到。",
    week: {
      previous: "上一周",
      next: "下一周",
      current: "本周",
    },
    brush: {
      label: "在时间表上拖动来画",
      hint: "选一种，在时间表上拖一下；点一下是一小时。",
    },
    kinds: {
      free: "有空",
      busy: "没空",
      meeting: "会议",
      task: "任务",
    },
    dueRow: "到期",
    allDay: "到期的任务",
    now: "现在",
    tasks: {
      title: "我的任务",
      hint: "点一个任务，再在时间表上拖出它要占用的时间。",
      toPlan: "还没排时间",
      planned: "已排时间",
      empty: "现在没有指派给你的未完成任务。",
      placing: (title: string) => `正在排「${title}」`,
      stopPlacing: "不排了",
    },
    editor: {
      titleLabel: "标题",
      titlePlaceholder: "例如：上课、组会",
      kindLabel: "类型",
      done: "完成",
      remove: "删除这段时间",
      unplan: "取消这段排期",
      openTask: "打开任务",
      taskNote: "标题和状态跟着任务走，要改请到看板里改。",
      finished: "任务已完成",
    },
    saving: "正在保存…",
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
      changeRole: "注册后获得的后台角色",
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
    colors: {
      title: "职能颜色",
      description:
        "总版、首页和任务卡片用这三种颜色区分开发、运营和营销。挑柔和一点的颜色，看起来不刺眼。",
      custom: "自定义",
      preview: "预览",
      save: "保存",
      saved: "已保存。",
      reset: "恢复默认",
      readOnly: "只有所有者和管理员能修改颜色。",
    },
    permissions: {
      title: "项目权限",
      description:
        "每个项目里，成员和访客分别能做什么。项目管理员总是拥有全部权限。改动立即生效，对方刷新页面后就能看到；没有权限的按钮和入口不会显示。",
      allProjects: "所有项目",
      allProjectsHint: "在这里改会同时改所有项目",
      mixed: "各项目不一致",
      permission: "权限",
      fixedTitle: "固定规则",
      fixedHint: "下面这些由 Hub 固定，不在这里改。",
      fixed: [
        "新建项目：只有后台管理员",
        "新建模板：只有项目管理员",
        "删除项目、管理计费：只有项目管理员",
      ],
      homeHint:
        "关掉某个角色的「查看看板」或「查看任务」后，这个角色在首页的「全部」里就看不到这个项目。",
      readOnly: "你是只读角色，只能查看。",
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
