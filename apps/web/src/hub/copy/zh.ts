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

  documents: {
    title: "文档",
    entry: "文档",
    description:
      "合同、方案、PPT 和其他文件都放在这里。所有成员都能查看和下载；要修改某份文档，需要有修改权限，可以在文档页向管理员申请。",
    searchPlaceholder: "搜索标题或文件名",
    root: "全部文档",
    searchResults: (count: number) => `找到 ${count} 份文档`,
    folderMeta: (documents: number, folders: number) =>
      folders > 0
        ? `${documents} 份文档 · ${folders} 个子文件夹`
        : `${documents} 份文档`,
    empty: {
      folder: "这里还没有文档。",
      search: "没有找到匹配的文档。",
      managerHint: "点右上角的「上传文件」添加第一份。",
    },
    noStorage:
      "还没有配置对象存储（bucket）：现在可以新建和编辑文本文档，但不能上传 PDF、PPT 等文件。请联系所有者配置。",
    columns: { name: "名称", type: "格式", size: "大小", updated: "更新" },
    badges: {
      canEdit: "可修改",
      hidden: "仅编辑者可见",
    },
    actions: {
      upload: "上传文件",
      newFolder: "新建文件夹",
      requests: "待处理申请",
      rename: "重命名",
      delete: "删除",
      deleteFolder: "删除文件夹",
      save: "保存",
      cancel: "取消",
      download: "下载",
      openNewTab: "新标签页打开",
      replace: "替换文件",
      edit: "编辑信息",
      newText: "新建文档",
      editText: "编辑内容",
    },
    newText: {
      title: "新建文档",
      hint: "直接在这里写，保存成一份文档。支持 Markdown、纯文本、HTML、CSV、JSON。",
      destination: "放进",
      titleLabel: "标题",
      formatLabel: "格式",
      contentLabel: "内容",
      contentPlaceholder: "在这里写……",
      readable: "所有成员可读",
      readableHint: "取消勾选后，只有能修改这份文档的人看得到它。",
      create: "创建",
      formats: {
        md: "Markdown（.md）",
        txt: "纯文本（.txt）",
        html: "HTML（.html）",
        csv: "CSV（.csv）",
        json: "JSON（.json）",
      },
    },
    editText: {
      title: "编辑内容",
      hint: "保存后会覆盖原来的内容，旧内容不保留。",
      save: "保存内容",
      saved: "已保存",
      loading: "读取内容中…",
    },
    folder: {
      namePlaceholder: "文件夹名称",
      create: "创建",
      renamePrompt: "新名称",
    },
    upload: {
      title: "上传文件",
      hint: "可以一次选多个。合同、方案、PPT、表格都行；HTML 和 PDF 可以在线预览，其他格式可下载。",
      choose: "选择文件",
      drop: "把文件拖到这里，或",
      destination: "放进",
      topLevel: "最上层",
      status: {
        waiting: "等待",
        preparing: "准备中",
        uploading: "上传中",
        finishing: "收尾",
        done: "完成",
        failed: "失败",
      },
      close: "关闭",
      progress: (done: number, total: number) => `已完成 ${done} / ${total}`,
    },
    detail: {
      back: "返回文档",
      uploadedBy: (name: string) => `${name} 上传`,
      size: "大小",
      format: "格式",
      updated: "最后更新",
      location: "位置",
      noPreview: "这种格式不能在线预览。点「下载」用本机的软件打开。",
      previewFailed: "预览打不开，可以试试下载。",
      title: "标题",
      descriptionLabel: "说明",
      folder: "所在文件夹",
      topLevel: "最上层",
      readable: "所有成员可读",
      readableHint: "关闭后，只有能修改这份文档的人看得到它。",
      deleteConfirm: "删除",
      replaceHint: "替换后原来的文件会被删掉。",
    },
    access: {
      title: "修改权限",
      hint: "查看对所有成员开放。修改权限按文档分配：所有者拥有全部，其他人需要被指派。",
      editors: "可以修改的人",
      nobody: "还没有被指派的人（所有者始终可以修改）。",
      you: "你",
      canEdit: "你可以修改这份文档。",
      revoke: "收回",
      grantTitle: "指派修改权限",
      grantPlaceholder: "输入姓名或邮箱搜索",
      grant: "指派",
      noMatch: "没有匹配的账号。",
      request: {
        title: "申请修改权限",
        hint: "留言写清楚想改什么，管理员会看到。",
        notePlaceholder: "例如：要更新合同日期",
        submit: "提交申请",
        pending: "申请已提交，等管理员处理。",
        approved: "你的申请已通过。",
        denied: "你的上一次申请没有通过，可以补充理由后再申请。",
      },
      pendingTitle: "待处理的申请",
      approve: "同意",
      deny: "拒绝",
      noPending: "没有待处理的申请。",
    },
    requests: {
      title: "修改权限申请",
      description:
        "成员申请修改文档的记录。所有者能处理全部；管理员只能处理自己负责的文档。",
      empty: "没有待处理的申请。",
      wants: (name: string) => `${name} 申请修改`,
      back: "返回文档",
    },
    loading: "加载中…",
    errors: {
      uploadFailed: "上传失败，请重试",
      network: "网络出错，请重试",
    },
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

  personal: {
    tabs: {
      schedule: "日程",
      done: "我完成的",
      github: "GitHub",
    },
  },

  github: {
    title: "GitHub",
    description:
      "连接 GitHub 后，可以看到你在自己所在项目的仓库里最近做了什么。只读取管理员给项目配好的仓库，而且只算你在的项目；Hub 用的 GitHub App 只有只读权限。",
    notConfigured: {
      heading: "GitHub 连接还没开通",
      body: "管理员需要先建好 Hub 的 GitHub App。开通之后这里会出现「连接 GitHub」按钮。",
    },
    connect: "连接 GitHub",
    reconnect: "重新连接",
    disconnect: "断开连接",
    sync: "同步最近活动",
    syncing: "正在同步…",
    connectedAs: (login: string) => `已连接 ${login}`,
    lastSynced: (when: string) => `上次同步：${when}`,
    neverSynced: "还没同步过，点「同步最近活动」读取最近 90 天。",
    outcomes: {
      connected: "GitHub 已连接。点「同步最近活动」读取最近 90 天的活动。",
      denied: "你在 GitHub 上取消了授权，没有连接。",
      expired: "这次连接已经过期或不完整，请再点一次「连接 GitHub」。",
      failed: "连接没有成功，请再试一次。如果一直不行，请联系管理员。",
      not_configured: "GitHub 连接还没开通，请联系管理员。",
    },
    windows: {
      30: "近 30 天",
      90: "近 90 天",
    },
    kinds: {
      commit: "提交",
      pr_opened: "提 PR",
      pr_merged: "PR 合并",
      issue_opened: "提 Issue",
    },
    repos: {
      title: "统计的仓库",
      hint: "管理员在后台给你所在的项目配的仓库。",
      none: "你所在的项目还没有配仓库，请联系管理员在后台「项目仓库」里添加。",
    },
    syncReport: {
      noAccess: (repo: string) =>
        `读不到 ${repo}：GitHub App 还没装到这个仓库，或者你在 GitHub 上没有它的访问权。`,
      failed: (repo: string) =>
        `读取 ${repo} 时 GitHub 出错了，稍后再同步一次。`,
      done: (count: number) => `同步完成，读到 ${count} 条活动。`,
    },
    byProject: "按项目（近 90 天）",
    recent: {
      title: "最近活动",
      empty: "近 90 天在这些仓库里还没有你的活动。",
    },
  },

  archive: {
    title: "我完成的",
    description:
      "卡片移到「已完成」的那一刻，它就自动归到这里。有负责人的任务记给负责人，没人负责的记给把它移过去的人。任务被重新打开就不再算。这里只有你自己能看到。",
    total: "累计完成",
    thisMonth: "本月完成",
    months: {
      title: "最近 12 个月",
      axis: (month: number) => `${month}月`,
      tooltip: (year: number, month: number, count: number) =>
        `${year} 年 ${month} 月 · ${count} 个`,
      tableCaption: "每月完成的任务数",
      monthColumn: "月份",
      countColumn: "完成数",
    },
    byProject: "按项目",
    byFunction: "按职能",
    otherBoards: "其他看板",
    recent: {
      title: "完成记录",
      monthHeading: (year: number, month: number) => `${year} 年 ${month} 月`,
      limited: (shown: number, total: number) =>
        `只列出最近 ${shown} 个，统计数字包含全部 ${total} 个。`,
      empty: "还没有完成的任务。卡片移到「已完成」后会自动出现在这里。",
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
    groups: {
      overview: "概览",
      people: "成员与准入",
      system: "系统管理",
      site: "官网",
    },
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
      siteHeading: "官网权限",
      siteHint:
        "能不能查看和处理官网上提交的数据，和后台角色无关。名单：看志愿者申请和加入登记，改志愿者的状态和备注；管理：在名单之外还能审核项目卡和项目进展。只有所有者能设置。",
      siteNone: "无",
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
    repos: {
      title: "项目仓库",
      description:
        "每个项目由哪些 GitHub 仓库组成。成员连接 GitHub 后，只统计他能看到的项目里的这些仓库；不在项目里的人，这个项目的仓库一个也不会算进去。",
      none: "还没有关联仓库。",
      placeholder: "owner/仓库名，或粘贴仓库链接",
      add: "关联仓库",
      remove: "取消关联",
      readOnly: "只有所有者和管理员能修改项目仓库。",
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
    site: {
      noAccess: {
        heading: "没有官网权限",
        body: "官网的数据只对被所有者授予了官网权限的人开放。如果你需要，请联系所有者。",
      },
      notConnected: {
        heading: "还没有连接官网数据库",
        body: "部署环境里还没有设置 HUB_SITE_DATABASE_URL，连接方法见仓库的 BUILDERSPACE.md。",
      },
      overview: {
        title: "官网概览",
        description:
          "官网上提交的项目和报名都在这里处理。数据直接读写官网的数据库，每一次审核、改状态和导出都会记进操作日志。",
        pendingProjects: "待审核的项目卡",
        pendingUpdates: "待审核的项目进展",
        newVolunteers: "未处理的志愿者申请",
        volunteersTotal: (count: number) => `共 ${count} 份`,
        joins: "加入登记",
        recentJoins: (count: number, days: number) =>
          `近 ${days} 天新增 ${count} 人`,
        supporters: "支持社团申请的人",
      },
      projects: {
        title: "项目审核",
        description:
          "访客在官网提交的项目卡和项目进展，通过后才会在官网公开。待审核的按提交先后排列，先到先审。",
        tabs: { projects: "项目卡", updates: "项目进展" },
        approve: "通过",
        reject: "驳回",
        takeDown: "下架",
        empty: "这里没有内容",
        submittedAt: "提交于",
        fields: {
          owner: "发起人",
          targetUser: "给谁用",
          needed: "在找",
          nextStep: "下一步",
          contact: "联系方式",
          links: "链接",
          media: "封面和视频",
        },
        repo: "代码仓库",
        demo: "Demo",
        cover: "有封面",
        video: (duration: string) => `演示视频 ${duration}`,
        noMedia: "没有上传",
        mediaHint:
          "封面和视频存在官网的私有存储里，原图和视频请看企业微信群的推送。",
        updateOf: (project: string) => `「${project}」的进展`,
        unknownProject: "（项目已删除）",
      },
      volunteers: {
        title: "志愿者申请",
        description:
          "想加入核心团队的人。状态和备注会直接写回官网的数据库；备注只有有官网权限的人能看到，不要写证件号这类信息。",
        all: "全部",
        email: "邮箱",
        contact: "联系方式",
        school: "学校 / 学位",
        positions: "想做的职位",
        hours: "每周时间",
        about: "自我介绍",
        portfolio: "作品链接",
        channel: "来源",
        status: "状态",
        notes: "备注",
        notesPlaceholder: "联系情况、面试安排…",
        saveNotes: "保存备注",
        saved: "已保存",
        empty: "还没有志愿者申请",
      },
      joins: {
        title: "加入登记",
        description:
          "在官网填写加入表单的人。勾选「只看支持社团申请的」可以拿到附有姓名和 zID 的支持者名单。",
        supportersOnly: "只看支持社团申请的",
        columns: {
          name: "昵称",
          school: "学校 / 专业",
          skills: "技能",
          hours: "每周时间",
          interest: "下次活动",
          availability: "方便的时间",
          source: "来源",
          supporter: "支持社团申请",
          createdAt: "登记时间",
        },
        empty: "还没有人登记",
      },
      export: "导出表格",
      exporting: "正在导出…",
      exported: (count: number) => `已导出 ${count} 条`,
      submittedAt: "提交于",
      // Keys are the website's own (src/lib/types.ts in its repo); a key
      // missing here is shown as is.
      labels: {
        positions: {
          events: "活动",
          content: "内容与渠道",
          design_media: "设计与影像",
          partnerships: "对外合作",
          recruiting: "招募与成员发展",
          product: "产品与项目",
          web_tools: "网站与工具",
          teaching: "教学与支持",
          tech_explore: "技术探索",
          secretary: "秘书与行政",
          finance: "财务",
        } as Record<string, string>,
        skills: {
          frontend: "前端",
          backend: "后端",
          design: "设计",
          product: "产品/商科",
          beginner: "零基础",
        } as Record<string, string>,
        roles: {
          frontend: "前端",
          backend: "后端",
          design: "设计",
          product: "产品/商科",
          tester: "试用者",
        } as Record<string, string>,
        hours: {
          lt2: "2 小时以内",
          "2to5": "2–5 小时",
          gt5: "5 小时以上",
        } as Record<string, string>,
        interest: {
          yes: "想来",
          maybe: "看时间",
          no: "这次不来",
        } as Record<string, string>,
        availability: {
          weekday_evening: "工作日晚上",
          weekend_day: "周末白天",
          online: "线上",
        } as Record<string, string>,
        referral: {
          xiaohongshu: "小红书",
          wechat: "微信群 / 朋友圈",
          friend: "朋友推荐",
          poster: "校园海报",
          other: "其他",
        } as Record<string, string>,
        updateKinds: {
          commit: "代码提交",
          demo: "Demo",
          post: "更新帖",
        } as Record<string, string>,
        projectStatus: {
          recruiting: "招募中",
          building: "进行中",
          demoed: "已 Demo",
          paused: "暂停",
        } as Record<string, string>,
      },
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
