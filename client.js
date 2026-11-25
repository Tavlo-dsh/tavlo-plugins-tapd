window.__ModuleLoader__.load({
  id: '@tavlo-dsh/dsh-plugin-tapd',
  factory(require) {
    const { createElement: h, useCallback, useEffect, useId, useRef, useState } = require('react')
    const { Input, Select, Disclosure, ArcStyle } = require('./ui/arcs');
    const TAPD_DOCS = 'https://open.tapd.cn/document/api-doc/API文档/'
    const BASIC_GUIDE = `${TAPD_DOCS}API配置指引.html`
    const API_GUIDE = `${TAPD_DOCS}使用必读.html`
    const SUPPORT = 'https://www.tapd.cn/official/support'
    const TOKEN_SETTINGS = 'https://www.tapd.cn/personal_settings/index?tab=personal_token'
    const TOKEN_GUIDE = 'https://www.tapd.cn/help/show#1120003271001001183'
    const PACKAGE = '@tavlo-dsh/dsh-plugin-tapd'
    const SLOT = 'plugins.bundle.config'
    const NS = 'tavlo-tapd-settings'
    const MAX_PROJECTS = 20

    const en = {
      title: 'TAPD sync settings',
      description: 'Bring TAPD work items into your task board. Nothing is sent back to TAPD.',
      connectionStep: 'Connect to TAPD', projectsStep: 'Choose what to sync', rangeStep: 'Sync limits',
      projectCount: '{count} selected', configuredConnection: 'Credentials available',
      rangeSummary: 'By last update',
      noneSelected: 'No statuses selected',
      storyCount: 'Story statuses: {count}', taskCount: 'Task statuses: {count}',
      projectLinkPlaceholder: 'https://www.tapd.cn/12345678/…',
      visualCredentials: 'Saved credentials', refs: 'Host credential references', none: 'Credentials not configured',
      syncState: 'Sync status', disabled: 'Disabled', waiting: 'Waiting for the Tavlo task board', ready: 'Task board connected',
      enabled: 'Enable TAPD sync', owner: 'TAPD assignee nickname',
      projects: 'TAPD projects', noProjects: 'No projects configured.',
      projectsHint: 'Select the statuses to sync for each project. Leave a work item type empty to skip it.',
      searchingProjects: 'Loading TAPD projects… You can enter a project ID without waiting.',
      tokenProjectHelp: 'Enter a personal access token, then choose Add project. No project ID or link is needed.',
      allProjectsAdded: 'All projects returned by TAPD are already selected.',
      projectAlternatives: 'Project lookup alternatives', addManually: 'Add manually',
      useProjectLink: 'Add from a link',
      linkedProjectNick: 'To look up a company from a link with a personal token, enter the token owner’s TAPD nickname.',
      currentUserUnavailable: 'TAPD did not identify the current user for this token. Check the token’s access or try a project link.',
      automaticContext: 'TAPD rejected the project lookup without a company. Try a project link to identify the company.',
      discoveryContext: 'For a company API account, add a project link under Project lookup alternatives if no company has been configured.',
      discoveryLink: 'TAPD project or work item link', discoveryLinkHint: 'Use only if automatic lookup fails or you need to choose a company. Only the project ID is saved.',
      discoveryLinkInvalid: 'Use a TAPD HTTPS link with a numeric project ID, or leave it blank.',
      companyProjectScope: 'This is the TAPD company’s project list. Access to a project’s work items is checked separately.',
      projectsEmpty: 'TAPD returned no projects for these credentials. Check project access or enter a project ID manually.',
      projectsPermission: 'These credentials can’t list TAPD projects. Ask your TAPD administrator about listing access, or enter a project ID manually.',
      projectsUnavailable: 'Could not load TAPD projects. Retry, or enter a project ID manually.',
      projectsPartial: 'Only part of the TAPD project list is available. Try refreshing or enter an unlisted project ID manually.',
      discoveryMissingCredentials: 'Set up TAPD credentials or Host references for the selected authentication method, then retry.',
      discoveryRejected: 'TAPD rejected these credentials. Check the authentication method and replace an invalid or expired credential, then retry.',
      discoveryThrottled: 'TAPD is limiting requests. Wait a moment and try again.',
      projectSearch: 'Search TAPD projects by name', chooseProject: 'TAPD project', chooseProjectPlaceholder: 'Choose a project',
      noProjectMatches: 'No projects match this search.', projectNamed: '{name} ({id})', savedProjectId: 'Current project ID ({id})',
      manualProject: 'Enter a project ID manually', manualProjectHint: 'Open the project in TAPD and click its name in the upper-left to find the project ID.',
      projectNameUnavailable: 'TAPD did not return the project name. You can still use the project ID.',
      loadStatuses: 'Load status options', refreshStatuses: 'Reload statuses', loadingStatuses: 'Loading TAPD statuses…',
      statusesHint: 'Load the statuses from TAPD, then check the names you want to sync.',
      statusesUnavailable: 'Could not read TAPD statuses. Check that the project still exists and is accessible, then retry.',
      statusesPermission: 'These credentials can’t read statuses for this project. Check your TAPD project access or ask your administrator.',
      statusesPartial: 'TAPD returned only some of the statuses. You can still use the options shown.',
      statusNetwork: 'Could not reach TAPD. Check the Host’s internet connection and try again.',
      statusTimeout: 'TAPD took too long to respond. Try again in a moment.',
      statusUnsupported: 'TAPD did not return a usable status list. Check whether this project exposes its statuses through the API.',
      statusesEmpty: 'TAPD returned no status options.',
      standardTaskHint: 'The project’s task status list could not be verified. These are TAPD’s standard options; selecting them does not confirm task access.',
      standardTaskOpen: 'Not started', standardTaskProgressing: 'In progress', standardTaskDone: 'Completed',
      storiesChoices: 'Story statuses', tasksChoices: 'Task statuses', statusNamed: '{label} ({key})',
      retainedStatuses: '{count} other selected statuses are not listed and will be kept.', removeUnavailableStatuses: 'Deselect unlisted statuses',
      guide: 'How to get TAPD credentials', basicGuide: 'Official TAPD API setup guide', applyGuide: 'Official TAPD API access instructions',
      basicStep: 'A TAPD Enterprise company administrator can request API access in 公司管理 → 开放集成 → API账号管理 (Company Management → Open Integration → API Account Management).',
      basicCopy: 'Enter the issued API account (api_user) and API password (api_password) in the Basic fields, not your TAPD login or password.',
      tokenStep: 'Sign in to TAPD and go to 我的 → 个人访问令牌 (My → Personal Access Tokens). Generate a token with read access to the projects you need, then paste just the token (without “Bearer”) into this settings page, not into a chat. If the option is missing, ask your TAPD administrator or use Basic authentication.',
      supportGuide: 'Official TAPD support', tokenDocs: 'Official TAPD personal token instructions', openTokenSettings: 'Open TAPD personal access token settings',
      lookback: 'Last-updated window', unrestricted: 'No time limit', lookbackPreset: 'Last {days} days', custom: 'Custom',
      lookbackDays: 'Number of days', lookbackHint: 'Each sync looks back from that round using the TAPD last-updated time in China time (UTC+8), not the creation date. It does not remove existing imports.',
      lookbackInvalid: 'Enter a whole number from 1 to 365 for the custom last-updated window.',
      project: 'Project {number}', workspaceId: 'TAPD project ID', targetWorkspaceId: 'DSH workspace', ungrouped: 'Ungrouped',
      workspaceImpact: 'Changes apply only to new imports. Existing tasks aren’t moved, and pending imports keep their original destination.',
      workspaceListUnavailable: 'The DSH workspace list is unavailable. Saved destinations are kept unless you change them to Ungrouped.',
      noWorkspaces: 'No DSH workspaces are registered. New imports can use Ungrouped.',
      missingWorkspace: 'Missing workspace ({id})', unverifiedWorkspace: 'Saved workspace ({id})',
      missingWorkspaceHint: 'New imports for this project are paused. Choose another workspace or Ungrouped to resume.',
      addProject: 'Add project', remove: 'Remove', removeProject: 'Remove project {number}',
      connection: 'TAPD connection', setupConnection: 'Set up TAPD connection',
      auth: 'Authentication', bearer: 'Personal access token (Bearer)', basic: 'API account and key (Basic)',
      credentialsHint: 'To replace a saved credential, enter the new value and choose Save credentials. Leave blank to keep the current value.',
      saveCredentials: 'Save credentials', savingCredentials: 'Saving credentials…', credentialsSaved: 'TAPD credentials saved. Other settings were not changed.',
      credentialsSaveFailed: 'Could not save TAPD credentials.',
      setupCredentialsHint: 'Enter your TAPD credentials and choose Save credentials, or configure credential references on the Host.',
      authChangedHint: 'Leave the fields blank to use any saved credentials or Host credential references for the selected method.',
      token: 'Personal access token', apiUser: 'API account', apiKey: 'API key',
      useRefs: 'Discard saved credentials and use Host credential references',
      useRefsHint: 'Discovery can try the references now. Saved credentials are discarded only when you save.',
      advanced: 'Advanced settings', interval: 'Polling interval (seconds)', intervalHint: '30–86,400 seconds between rounds.',
      maxNew: 'Maximum new items per scope', maxNewHint: '1–1,000 per project and item type. If more items match, that scope imports nothing in that round.',
      loading: 'Loading TAPD settings…', save: 'Save settings', saving: 'Saving…', saved: 'TAPD settings saved.',
      retry: 'Retry loading', reload: 'Reload settings and discard draft',
      loadFailed: 'Could not load TAPD settings. Try again.', saveFailed: 'Could not save TAPD settings.',
      saveUnconfirmed: 'Could not confirm the save. Reload to check the latest settings before saving again.',
      conflict: 'These settings were changed elsewhere. Reload the current settings before saving again.',
      invalidConfig: 'Check the assignee nickname, project IDs, status keys, and polling limits.',
      duplicateProject: 'Each TAPD project ID can only appear once.',
      missingScopes: 'Add at least one project with a story or task status key to enable sync.',
      invalidCredentials: 'The replacement credentials are invalid. For Basic authentication, enter both the API account and key.',
      unavailable: 'TAPD settings are unavailable on this Host.',
      workspaceUnavailable: 'The selected destination can’t be assigned. Reload settings for the current workspace list, or choose Ungrouped.',
    }
    const zh = {
      title: 'TAPD 同步设置',
      description: '把 TAPD 的需求和任务导入你的任务看板。不回写 TAPD。',
      connectionStep: '连接 TAPD', projectsStep: '选择同步项目', rangeStep: '设置同步范围',
      projectCount: '已选 {count} 个', configuredConnection: '凭据就绪',
      rangeSummary: '按最后更新时间',
      noneSelected: '未选择状态',
      storyCount: '{count} 个需求状态', taskCount: '{count} 个任务状态',
      projectLinkPlaceholder: 'https://www.tapd.cn/12345678/…',
      visualCredentials: '已保存凭据', refs: 'Host 凭据引用', none: '尚未配置凭据',
      syncState: '同步状态', disabled: '未启用', waiting: '等待 Tavlo 任务看板', ready: '任务看板已连接',
      enabled: '启用 TAPD 同步', owner: 'TAPD 处理人昵称',
      projects: 'TAPD 项目', noProjects: '尚未配置项目。',
      projectsHint: '为每个项目选择要同步的状态。某种工作项不选状态，就不同步该类型。',
      searchingProjects: '正在加载 TAPD 项目…也可以直接输入项目 ID，无需等待。',
      tokenProjectHelp: '填入个人访问令牌后，点「添加项目」即可尝试获取项目，不需要填 ID 或链接。',
      allProjectsAdded: 'TAPD 返回的项目都已选中。',
      projectAlternatives: '其他添加方式', addManually: '手动添加',
      useProjectLink: '从链接添加',
      linkedProjectNick: '使用个人令牌按链接查询公司项目时，请填写令牌持有人的 TAPD 昵称。',
      currentUserUnavailable: 'TAPD 未能从令牌识别当前用户。请检查令牌权限，或改用项目链接。',
      automaticContext: 'TAPD 未接受不指定公司的项目查询。可改用项目链接识别公司。',
      discoveryContext: '使用企业 API 账号时，如果尚未配置公司，请在「其他添加方式」中补充一个 TAPD 项目链接。',
      discoveryLink: 'TAPD 项目或工作项链接', discoveryLinkHint: '仅在自动获取失败或需要指定公司时填写。只保存项目 ID。',
      discoveryLinkInvalid: '请输入包含数字项目 ID 的 TAPD HTTPS 链接，或留空。',
      companyProjectScope: '这是 TAPD 公司项目列表，工作项读取权限由各项目另行控制。',
      projectsEmpty: 'TAPD 未返回当前凭据可访问的项目。请检查项目权限，或手动输入项目 ID。',
      projectsPermission: '当前凭据无权列出 TAPD 项目。请联系 TAPD 管理员确认是否有列出项目的权限，或手动输入项目 ID。',
      projectsUnavailable: '无法加载 TAPD 项目。请重试，或手动输入项目 ID。',
      projectsPartial: '仅获取到部分 TAPD 项目。可尝试刷新，或手动输入未列出的项目 ID。',
      discoveryMissingCredentials: '请为所选认证方式配置 TAPD 凭据或 Host 凭据引用，然后重试。',
      discoveryRejected: 'TAPD 拒绝了当前凭据。请确认认证方式，替换无效或过期的凭据，然后重试。',
      discoveryThrottled: 'TAPD 正在限制请求频率。请稍后重试。',
      projectSearch: '按名称搜索 TAPD 项目', chooseProject: 'TAPD 项目', chooseProjectPlaceholder: '选择项目',
      noProjectMatches: '没有符合搜索条件的项目。', projectNamed: '{name}（{id}）', savedProjectId: '当前项目 ID（{id}）',
      manualProject: '手动输入项目 ID', manualProjectHint: '在 TAPD 中打开对应项目，点击左上角的项目名称查看项目 ID。',
      projectNameUnavailable: '暂时读不到 TAPD 项目名称，仍可使用项目 ID。',
      loadStatuses: '读取可选状态', refreshStatuses: '重新读取状态', loadingStatuses: '正在读取 TAPD 状态…',
      statusesHint: '从 TAPD 读取状态后，勾选要同步的名称。',
      statusesUnavailable: '暂时读不到 TAPD 状态。请确认项目仍可访问，再重新读取。',
      statusesPermission: '当前凭据没有读取状态的权限。请在 TAPD 检查对此项目的访问权限，或联系管理员。',
      statusesPartial: 'TAPD 只返回了部分状态，可先使用已读取的选项。',
      statusNetwork: '目前连接不到 TAPD。请检查 Tavlo 所在设备的网络后再试。',
      statusTimeout: 'TAPD 响应超时，请稍后重新读取。',
      statusUnsupported: 'TAPD 没有返回可用的状态列表。请确认项目已开放相应接口，再重新读取。',
      statusesEmpty: 'TAPD 未返回可选状态。',
      standardTaskHint: '未能核实此项目的任务状态。以下为 TAPD 标准选项，勾选不代表已获得任务读取权限。',
      standardTaskOpen: '未开始', standardTaskProgressing: '进行中', standardTaskDone: '已完成',
      storiesChoices: '需求状态', tasksChoices: '任务状态', statusNamed: '{label}（{key}）',
      retainedStatuses: '另有 {count} 个已选状态未出现在列表中，仍会保留。', removeUnavailableStatuses: '取消选择未列出的状态',
      guide: '如何获取 TAPD 凭据', basicGuide: 'TAPD 官方 API 配置指引', applyGuide: 'TAPD 官方 API 账号申请说明',
      basicStep: 'TAPD 企业版的公司管理员可以在「公司管理 → 开放集成 → API 账号管理」下申请 API 访问。',
      basicCopy: '在 Basic 字段中分别填写获发的 API 账号（api_user）和 API 口令（api_password），而不是 TAPD 登录账号和密码。',
      tokenStep: '登录 TAPD，前往「我的 → 个人访问令牌」，生成可读取所需项目的令牌。只将令牌本身（不要加 Bearer）粘贴到此设置页，不要发到对话里。如果没有此入口，请联系 TAPD 管理员或改用 Basic 认证。',
      supportGuide: 'TAPD 官方客户服务', tokenDocs: 'TAPD 官方个人令牌说明', openTokenSettings: '打开 TAPD 个人访问令牌设置',
      lookback: '最近更新时间范围', unrestricted: '不限时间', lookbackPreset: '最近 {days} 天', custom: '自定义',
      lookbackDays: '天数', lookbackHint: '每轮同步从本轮时间往前推算，按 TAPD 的最后更新时间筛选（中国时间 UTC+8），不是创建时间。不会移除已经导入的任务。',
      lookbackInvalid: '请为自定义更新时间范围输入 1 至 365 之间的整数。',
      project: '项目 {number}', workspaceId: 'TAPD 项目 ID', targetWorkspaceId: 'DSH 工作区', ungrouped: '未分组',
      workspaceImpact: '更改仅影响新导入的任务，不会移动已有任务，待导入任务仍使用原目标。',
      workspaceListUnavailable: '暂时无法获取 DSH 工作区列表。除非改为「未分组」，否则保留已保存的目标。',
      noWorkspaces: '尚未注册 DSH 工作区，新导入的任务可归入「未分组」。',
      missingWorkspace: '工作区不存在（{id}）', unverifiedWorkspace: '已保存的工作区（{id}）',
      missingWorkspaceHint: '此项目暂停导入新任务。请选择其他工作区或「未分组」以恢复导入。',
      addProject: '添加项目', remove: '移除', removeProject: '移除项目 {number}',
      connection: 'TAPD 连接', setupConnection: '设置 TAPD 连接',
      auth: '认证方式', bearer: '个人访问令牌（Bearer）', basic: 'API 账号和密钥（Basic）',
      credentialsHint: '要更换凭据，请填入新值后点「保存凭据」。留空继续使用当前凭据，已保存的值不会显示。',
      saveCredentials: '保存凭据', savingCredentials: '正在保存凭据…', credentialsSaved: 'TAPD 凭据已保存，其他设置未更改。',
      credentialsSaveFailed: '无法保存 TAPD 凭据。',
      setupCredentialsHint: '请填写 TAPD 凭据后点「保存凭据」，也可以在 Host 上配置凭据引用。',
      authChangedHint: '留空则使用所选认证方式对应的已保存凭据或 Host 凭据引用。',
      token: '个人访问令牌', apiUser: 'API 账号', apiKey: 'API 密钥',
      useRefs: '丢弃已保存的凭据，改用 Host 凭据引用',
      useRefsHint: '发现操作可以立即试用 Host 引用；仅在保存设置时才会丢弃已保存的凭据。',
      advanced: '高级设置', interval: '轮询间隔（秒）', intervalHint: '两轮之间间隔 30–86,400 秒。',
      maxNew: '单范围最多新增条数', maxNewHint: '每个项目、每种工作项类型 1–1,000 条。如果超过上限，本轮不导入该范围内的工作项。',
      loading: '正在加载 TAPD 设置…', save: '保存设置', saving: '正在保存…', saved: 'TAPD 设置已保存。',
      retry: '重试加载', reload: '重新加载设置并丢弃草稿',
      loadFailed: '无法加载 TAPD 设置，请重试。', saveFailed: '无法保存 TAPD 设置。',
      saveUnconfirmed: '无法确认保存结果。请重新加载以核对最新设置，再尝试保存。',
      conflict: '其他地方已修改这些设置。请重新加载当前设置后再保存。',
      invalidConfig: '请检查处理人昵称、项目 ID、所选状态和同步频率。',
      duplicateProject: '每个 TAPD 项目 ID 只能填写一次。',
      missingScopes: '请至少为一个项目勾选一种需求或任务状态，再启用同步。',
      invalidCredentials: '替换凭据无效。使用 Basic 认证时，请同时填写 API 账号和密钥。',
      unavailable: '此 Host 上的 TAPD 设置不可用。',
      workspaceUnavailable: '无法分配所选目标。请重新加载设置以获取最新列表，或改为「未分组」。',
    }

    const errorKeys = new Map([
      ['tapd/revision-conflict', 'conflict'],
      ['tapd/invalid-config', 'invalidConfig'],
      ['tapd/duplicate-project', 'duplicateProject'],
      ['tapd/missing-scopes', 'missingScopes'],
      ['tapd/invalid-credentials', 'invalidCredentials'],
      ['tapd/settings-unavailable', 'unavailable'],
      ['tapd/workspace-unavailable', 'workspaceUnavailable'],
    ])
    const credentialLabels = { visual: 'visualCredentials', refs: 'refs', none: 'none' }
    const syncLabels = { disabled: 'disabled', 'waiting-for-board': 'waiting', ready: 'ready' }
    const emptySecrets = () => ({ token: '', apiUser: '', apiKey: '' })
    const isWorkspaceId = value => typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)
    const isProjectId = value => typeof value === 'string' && /^[0-9]{1,32}$/.test(value)
    const isStatusKey = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(value)
    const splitKeys = text => [...new Set(text.split(/[,，\s]+/u).filter(Boolean))]
    const lookbackPresets = ['7', '30', '90']
    const validLookback = value => Number.isInteger(value) && value >= 1 && value <= 365
    // A pasted URL is local input only. Neither its query/fragment nor its authority leaves the form.
    function seedProject(link) {
      try {
        const url = new URL(link)
        if (!['https://www.tapd.cn', 'https://tapd.cn'].includes(url.origin) || url.username || url.password) return undefined
        return /^\/([0-9]{1,32})(?:\/|$)/.exec(url.pathname)?.[1]
      } catch {
        return undefined
      }
    }

    function discoveryError(code, projects, auto) {
      switch (code) {
        case 'tapd/invalid-credentials': return 'discoveryMissingCredentials'
        case 'tapd/auth': return 'discoveryRejected'
        case 'tapd/discovery-forbidden': return projects ? 'projectsPermission' : 'statusesPermission'
        case 'tapd/rate-limit': return 'discoveryThrottled'
        case 'tapd/network': return projects ? 'projectsUnavailable' : 'statusNetwork'
        case 'tapd/timeout': return projects ? 'projectsUnavailable' : 'statusTimeout'
        case 'tapd/malformed':
        case 'tapd/discovery-limit': return projects ? 'projectsUnavailable' : 'statusUnsupported'
        case 'tapd/current-user-unavailable': return 'currentUserUnavailable'
        case 'tapd/project-context-required': return auto ? 'automaticContext' : 'discoveryContext'
        default: return projects ? 'projectsUnavailable' : 'statusesUnavailable'
      }
    }

    function decodeProjects(value) {
      if (!Array.isArray(value?.projects)) return null
      const projects = new Map()
      for (const project of value.projects) {
        if (!isProjectId(project?.id) || typeof project.name !== 'string' || !project.name.trim() || projects.has(project.id)) return null
        projects.set(project.id, project.name)
      }
      return projects
    }

    function decodeStatuses(value) {
      if (!Array.isArray(value?.stories) || !Array.isArray(value.tasks)) return null
      const decode = rows => {
        const statuses = new Map()
        for (const row of rows) {
          if (!isStatusKey(row?.key) || typeof row.label !== 'string' || !row.label.trim() || statuses.has(row.key)) return null
          statuses.set(row.key, row.label)
        }
        return statuses
      }
      const stories = decode(value.stories)
      const tasks = decode(value.tasks)
      if (!stories || !tasks) return null
      const issues = Object.fromEntries(['stories', 'tasks'].filter(type => typeof value.errors?.[type] === 'string')
        .map(type => [type, discoveryError(value.errors[type], false)]))
      const useStandardTasks = value.standardTaskOptions === true && !!issues.tasks && !tasks.size && stories.size > 0
        && ['tapd/api', 'tapd/http', 'tapd/malformed'].includes(value.errors.tasks)
      return { stories, tasks, issues, useStandardTasks }
    }

    function prepareCredentials({ auth, useRefs, token, apiUser, apiKey }) {
      if (useRefs) return { credentials: { mode: 'use-refs' } }
      if (auth === 'bearer' && token !== '') {
        if (!token.trim()) return { error: 'invalidCredentials' }
        return { credentials: { mode: 'replace', token } }
      }
      if (auth === 'basic' && (apiUser !== '' || apiKey !== '')) {
        if (!apiUser.trim() || !apiKey.trim()) return { error: 'invalidCredentials' }
        return { credentials: { mode: 'replace', apiUser, apiKey } }
      }
      return {}
    }

    function decodeWorkspaces(workspaceStatus, workspaces) {
      if (workspaceStatus !== 'ready' || !Array.isArray(workspaces)) return null
      const catalog = new Map()
      for (const row of workspaces) {
        if (!isWorkspaceId(row?.id) || typeof row.title !== 'string' || typeof row.path !== 'string' || catalog.has(row.id)) return null
        catalog.set(row.id, { title: row.title || row.path || row.id, path: row.path })
      }
      return catalog
    }

    // Project only the public response fields onto the form; never retain a Host error message or extra fields.
    function decodeSnapshot(value, nextId) {
      const { revision, source, configured, credentialSource, syncState, config, workspaceStatus, workspaces } = value ?? {}
      if (!Number.isSafeInteger(revision) || revision < 0 || !['profile', 'visual'].includes(source)
        || typeof configured !== 'boolean' || typeof credentialSource !== 'string' || !Object.hasOwn(credentialLabels, credentialSource)
        || typeof syncState !== 'string' || !Object.hasOwn(syncLabels, syncState) || !config) return null
      const { enabled, auth, owner, projects, intervalSeconds, maxNewPerScope, lookbackDays, companyId, seedWorkspaceId } = config
      const windowDays = lookbackDays === undefined ? '' : String(lookbackDays)
      const textList = values => Array.isArray(values) && values.every(value => typeof value === 'string')
      if (typeof enabled !== 'boolean' || !['bearer', 'basic'].includes(auth) || typeof owner !== 'string'
        || !Number.isInteger(intervalSeconds) || !Number.isInteger(maxNewPerScope) || !Array.isArray(projects)
        || (lookbackDays !== undefined && !validLookback(lookbackDays)) || (companyId !== undefined && !isProjectId(companyId))
        || (seedWorkspaceId !== undefined && !isProjectId(seedWorkspaceId))
        || projects.length > MAX_PROJECTS || !projects.every(project => typeof project?.workspaceId === 'string'
          && textList(project.stories) && textList(project.tasks)
          && (project.targetWorkspaceId === undefined || isWorkspaceId(project.targetWorkspaceId)))) return null
      return {
        snapshot: {
          revision, auth, configured, credentialSource, syncState,
          catalog: decodeWorkspaces(workspaceStatus, workspaces),
          projectTargets: new Map(projects.map(({ workspaceId, targetWorkspaceId }) => [workspaceId, targetWorkspaceId])),
        },
        draft: {
          enabled, auth, owner, companyId,
           discoveryLink: seedWorkspaceId ? `https://www.tapd.cn/${seedWorkspaceId}/` : '',
          intervalSeconds: String(intervalSeconds), maxNewPerScope: String(maxNewPerScope),
          lookback: !windowDays || lookbackPresets.includes(windowDays) ? windowDays : 'custom', lookbackDays: windowDays,
          projects: projects.map(({ workspaceId, stories, tasks, targetWorkspaceId = '' }) => ({
            id: nextId.current++, workspaceId, lookupWorkspaceId: workspaceId,
            stories: stories.join(', '), tasks: tasks.join(', '), targetWorkspaceId,
          })),
          useRefs: false, ...emptySecrets(),
        },
      }
    }

    function prepareSave(draft, snapshot) {
      const { enabled, auth } = draft
      const owner = draft.owner.trim()
      if (owner.length > 128 || /[<>|;,\p{Cc}]/u.test(owner) || (enabled && !owner)) return { error: 'invalidConfig' }
      const intervalSeconds = Number(draft.intervalSeconds)
      const maxNewPerScope = Number(draft.maxNewPerScope)
      if (!/^\d+$/.test(draft.intervalSeconds) || intervalSeconds < 30 || intervalSeconds > 86400
        || !/^\d+$/.test(draft.maxNewPerScope) || maxNewPerScope < 1 || maxNewPerScope > 1000
        || draft.projects.length > MAX_PROJECTS) return { error: 'invalidConfig' }
      const lookbackText = draft.lookback === 'custom' ? draft.lookbackDays : draft.lookback
      const lookbackDays = Number(lookbackText)
      if (draft.lookback && (!/^\d+$/.test(lookbackText) || !validLookback(lookbackDays))) return { error: 'lookbackInvalid' }
      const validKeys = keys => keys.length <= 32 && keys.every(isStatusKey)
      const projects = draft.projects.map(({ workspaceId, stories, tasks, targetWorkspaceId }) => ({
        workspaceId, stories: splitKeys(stories), tasks: splitKeys(tasks), ...(targetWorkspaceId && { targetWorkspaceId }),
      }))
      if (projects.some(project => !isProjectId(project.workspaceId)
        || !validKeys(project.stories) || !validKeys(project.tasks))) return { error: 'invalidConfig' }
      if (new Set(projects.map(project => project.workspaceId)).size !== projects.length) return { error: 'duplicateProject' }
      if (enabled && !projects.some(project => project.stories.length || project.tasks.length)) return { error: 'missingScopes' }
      if (projects.some(({ workspaceId, targetWorkspaceId }) => targetWorkspaceId && !snapshot.catalog?.has(targetWorkspaceId)
        && snapshot.projectTargets.get(workspaceId) !== targetWorkspaceId)) return { error: 'workspaceUnavailable' }
      const { credentials, error } = prepareCredentials(draft)
      if (error) return { error }
      const link = draft.discoveryLink.trim()
      const seedWorkspaceId = link ? seedProject(link) : undefined
      if (link && !seedWorkspaceId) return { error: 'discoveryLinkInvalid' }
      const config = { enabled, auth, owner, projects, intervalSeconds, maxNewPerScope,
        ...(draft.lookback && { lookbackDays }), ...(draft.companyId && { companyId: draft.companyId }),
        ...(seedWorkspaceId && { seedWorkspaceId }) }
      return { input: { expectedRevision: snapshot.revision, config, ...(credentials && { credentials }) } }
    }

    const box = { display: 'grid', gap: 12, minWidth: 0 }
    const line = { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px 12px', minWidth: 0 }
    const split = { ...line, justifyContent: 'space-between', alignItems: 'center' }
    const field = { display: 'grid', gap: 4, flex: '1 1 180px', minWidth: 0 }
    function Step({ id, number, title, actions, children }) {
      return h('section', { className: 'tapd-step', 'aria-labelledby': id },
        h('span', { className: 'tapd-step-index', 'aria-hidden': true }, number),
        h('div', { className: 'tapd-step-content' },
          h('div', { className: 'tapd-step-header' }, h('h3', { id }, title), actions), children),
      )
    }
    const message = { margin: 0, color: 'var(--dsw-alias-label-secondary, currentColor)', overflowWrap: 'anywhere' }
    const warning = { ...message, borderInlineStart: '2px solid var(--dsw-alias-state-warn-primary, currentColor)', paddingInlineStart: 8 }
    const labelStyle = { fontWeight: 500 }

    function Field({ id, label, hint, warn, value, onChange, choices, ...attrs }) {
      const props = {
        id, value,
        'aria-describedby': hint ? `${id}-hint` : undefined, ...attrs,
      }
      return h('div', { className: 'tapd-field', style: field },
        h('label', { id: `${id}-label`, className: 'tapd-field-label', htmlFor: id, style: labelStyle }, label),
        choices ? h(Select, { ...props, choices, onChange, 'aria-labelledby': `${id}-label` })
          : h(Input, { ...props, onChange: event => onChange(event.currentTarget.value) }),
        hint && h('small', { id: `${id}-hint`, style: warn ? warning : message }, hint),
      )
    }

    // A single combobox: typing is a filter, and only a committed option changes the project.
    function ProjectPicker({ t, id, name, value, choices, onSelect }) {
      const [search, setSearch] = useState('')
      const [open, setOpen] = useState(false)
      const [active, setActive] = useState(-1)
      const listRef = useRef(null)
      const term = search.trim().toLocaleLowerCase()
      const matches = choices.filter(([key, label]) => !term || key.includes(term) || label.toLocaleLowerCase().includes(term))
      const options = matches.filter(([, , disabled]) => !disabled)
      const candidate = options[active]
      const listId = id + '-options'
      const optionId = key => `${listId}-${key}`
      useEffect(() => {
        if (open && candidate) listRef.current?.children[matches.indexOf(candidate)]?.scrollIntoView({ block: 'nearest' })
      }, [open, candidate?.[0]])
      const close = () => { setOpen(false); setSearch(''); setActive(-1) }
      const choose = key => { close(); onSelect(key) }
      const move = step => {
        if (!options.length) return
        const next = active < 0 ? (step > 0 ? 0 : options.length - 1) : (active + step + options.length) % options.length
        setActive(next)
      }
      return h('div', { className: 'tapd-picker tapd-field', onBlur(event) {
        if (!event.currentTarget.contains(event.relatedTarget)) close()
      } }, h('label', { className: 'tapd-field-label', htmlFor: id }, t('chooseProject')),
        h(Input, { id, type: 'text', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': open, 'aria-controls': listId,
          'aria-activedescendant': open && candidate ? optionId(candidate[0]) : undefined, value: open ? search : name,
          placeholder: open ? t('projectSearch') : t('chooseProjectPlaceholder'), spellCheck: false, autoComplete: 'off',
          onFocus: () => setOpen(true), onClick: () => setOpen(true),
          onChange: event => { setOpen(true); setActive(-1); setSearch(event.currentTarget.value) },
          onKeyDown(event) {
            if (event.nativeEvent?.isComposing) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setOpen(true); move(event.key === 'ArrowDown' ? 1 : -1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (open && (candidate || options.length === 1)) choose((candidate || options[0])[0])
              else setOpen(true)
            } else if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
            else if (event.key === 'Tab') close()
          },
        }),
        h('div', { className: 'tapd-picker-popup', hidden: !open },
          h('ul', { ref: listRef, role: 'listbox', id: listId, 'aria-label': t('chooseProject') }, matches.map(([key, label, disabled]) => h('li', {
            key, id: optionId(key), role: 'option', 'aria-selected': key === value, 'aria-disabled': disabled || undefined,
            'data-active': key === candidate?.[0] || undefined,
            onMouseDown: event => event.preventDefault(), onClick: disabled ? undefined : () => choose(key),
          }, label))), !matches.length ? h('p', { role: 'status' }, t('noProjectMatches')) : null))
    }

    function Details({ title, annotation, defaultOpen, children }) {
      return h(Disclosure, { title, annotation, defaultOpen }, h('div', { style: box }, children))
    }

    function SyncSwitch({ label, checked, disabled, onChange }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked, disabled, onClick: () => onChange(!checked),
        style: { ...line, alignItems: 'center', border: 0, padding: 0, minHeight: 36, font: 'inherit', fontWeight: 600,
          textAlign: 'start', color: 'inherit', background: 'transparent', cursor: disabled ? 'default' : 'pointer' },
      },
        h('span', { 'aria-hidden': true, style: {
          display: 'flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start', width: 36, height: 20,
          boxSizing: 'border-box', borderRadius: 999, paddingInline: 2, flex: '0 0 auto',
          background: checked ? 'var(--dsw-alias-brand-primary, Highlight)' : 'var(--dsw-alias-border-l3, GrayText)',
          border: '1px solid var(--dsw-alias-border-l3, GrayText)', opacity: disabled ? 0.5 : 1,
        } }, h('span', { style: {
          width: 14, height: 14, borderRadius: '50%', background: checked
            ? 'var(--dsw-alias-label-primary-foreground, HighlightText)' : 'var(--dsw-alias-switch-thumb, Canvas)',
          border: '1px solid var(--dsw-alias-border-l3, GrayText)',
        } })), label,
      )
    }

    function useKnownProjectNames(request, snapshot, draft, catalog, paused) {
      const [lookup, setLookup] = useState(null)
      // Never send credentials from the draft implicitly. Catalog and status reads are explicit actions.
      const context = !paused && snapshot?.configured && draft.auth === snapshot.auth
        && !draft.useRefs && !draft.token && !draft.apiUser && !draft.apiKey ? snapshot : null
      const ids = context ? [...new Set(draft.projects.map(row => row.lookupWorkspaceId)
        .filter(id => isProjectId(id) && !catalog?.has(id)))].sort().join(',') : ''
      useEffect(() => {
        if (!ids) return
        const controller = new AbortController()
        const workspaceIds = ids.split(',')
        const finish = names => {
          if (!controller.signal.aborted) setLookup({ context, ids, names: names ?? new Map() })
        }
        void request('discover-project-names', { auth: context.auth, workspaceIds }, controller.signal).then(result => {
          finish(result?.ok === true ? decodeProjects(result.value) : null)
        }, () => finish(null))
        return () => controller.abort()
      }, [request, context, ids])
      return context && lookup?.context === context && lookup.ids === ids ? lookup.names : null
    }

    function SettingsForm({ t, request }) {
      const baseId = useId()
      const nextId = useRef(0)
      const active = useRef(null)
      const discovering = useRef(new Map())
      const [page, setPage] = useState({ pending: 'get' })
      const run = useCallback(async (operation, input) => {
        if (active.current) return
        const ticket = {}
        active.current = ticket
        const saving = operation !== 'get'
        const atConnection = operation === 'save-credentials'
        if (saving) discovering.current.delete('projects')
        setPage(previous => ({ ...previous, pending: operation, error: null, notice: null, atConnection,
          metadata: previous.metadata?.projects?.loading
            ? { ...previous.metadata, projects: { ...previous.metadata.projects, loading: false } }
            : previous.metadata,
        }))
        try {
          const result = await request(operation, input)
          if (active.current !== ticket) return
          if (result?.ok === true) {
            const decoded = decodeSnapshot(result.value, nextId)
            if (decoded) {
              const keepMetadata = saving && !input.credentials
              if (!keepMetadata) discovering.current.clear()
              setPage(previous => ({ ...decoded,
                draft: atConnection ? { ...previous.draft, useRefs: false, ...emptySecrets() } : decoded.draft,
                atConnection, notice: atConnection ? 'credentialsSaved' : saving ? 'saved' : null,
                metadata: keepMetadata ? previous.metadata : { projects: null, statuses: new Map() },
              }))
              return
            }
          } else if (result?.ok === false) {
            const error = errorKeys.get(result.error?.code) ?? (atConnection ? 'credentialsSaveFailed' : saving ? 'saveFailed' : 'loadFailed')
            setPage(previous => ({
              ...previous, pending: null, error, reloadRequired: !saving || error === 'conflict',
            }))
            return
          }
          // A malformed save reply, like a transport failure, leaves the result uncertain.
          setPage(previous => ({ ...previous, pending: null, error: saving ? 'saveUnconfirmed' : 'loadFailed', reloadRequired: true }))
        } catch {
          if (active.current === ticket) {
            setPage(previous => ({ ...previous, pending: null, error: saving ? 'saveUnconfirmed' : 'loadFailed', reloadRequired: true }))
          }
        } finally {
          if (active.current === ticket) active.current = null
        }
      }, [request])
      useEffect(() => {
        void run('get', {})
        return () => { active.current = null; discovering.current.clear() }
      }, [run])

      const { draft, snapshot, pending, error, notice, atConnection, reloadRequired, metadata } = page
      const projectDiscovery = metadata?.projects
      const projectNames = projectDiscovery?.data
      const knownProjectNames = useKnownProjectNames(request, snapshot, draft, projectNames, pending || reloadRequired)
      const controlId = key => `${baseId}-${key}`
      const edit = (updater, invalidate) => {
        if (invalidate === 'credentials') discovering.current.clear()
        else if (invalidate === 'projects') discovering.current.delete('projects')
        setPage(previous => ({
          ...previous, draft: updater(previous.draft), error: previous.reloadRequired ? previous.error : null, notice: null,
          metadata: invalidate === 'credentials' ? { projects: null, statuses: new Map() }
            : invalidate === 'projects' ? { ...previous.metadata, projects: null } : previous.metadata,
        }))
      }
      const setField = (key, value) => edit(old => ({ ...old, [key]: value }),
        ['token', 'apiUser', 'apiKey'].includes(key) ? 'credentials'
          : ['owner', 'discoveryLink'].includes(key) ? 'projects' : undefined)
      const setDiscovery = (workspaceId, entry, onProjects) => setPage(previous => {
        const metadata = previous.metadata
        if (workspaceId !== undefined) {
          const statuses = new Map(metadata.statuses)
          statuses.set(workspaceId, { ...statuses.get(workspaceId), ...entry })
          return { ...previous, metadata: { ...metadata, statuses } }
        }
        return { ...previous, draft: onProjects ? onProjects(previous.draft) : previous.draft,
          metadata: { ...metadata, projects: { ...metadata.projects, ...entry } } }
      })
      const appendProject = (old, id, seed) => {
        if (old.projects.length >= MAX_PROJECTS) return old
        const workspaceId = seed && !old.projects.some(row => row.workspaceId === seed) ? seed : ''
        return { ...old, projects: [...old.projects, { id, workspaceId, lookupWorkspaceId: workspaceId,
          stories: '', tasks: '', targetWorkspaceId: '',
        }] }
      }
      const projectOptionsLeft = (old, options) => {
        const selected = new Set(old.projects.map(row => row.workspaceId))
        return [...options.keys()].some(id => !selected.has(id))
      }
      const appendChooser = (old, id) => old.projects.some(row => !row.workspaceId) ? old : appendProject(old, id)
      const discover = async (workspaceId, seedWorkspaceId, fromLink = false) => {
        const projects = workspaceId === undefined
        const key = projects ? 'projects' : workspaceId
        if (pending || reloadRequired || active.current || discovering.current.has(key)) return
        const { credentials, error } = prepareCredentials(draft)
        if (error) return setDiscovery(workspaceId, { issue: error })
        const input = { auth: draft.auth, ...(credentials && { credentials }) }
        if (projects) {
          if (draft.auth === 'bearer' && !seedWorkspaceId) {
            input.auto = true
          } else {
            if (seedWorkspaceId) input.seedWorkspaceId = seedWorkspaceId
            else if (draft.companyId) input.companyId = draft.companyId
            else return setDiscovery(undefined, { issue: 'discoveryContext' })
            if (draft.auth === 'bearer') {
              const nick = draft.owner.trim()
              if (!nick) return setDiscovery(undefined, { issue: 'linkedProjectNick' })
              input.nick = nick
            }
          }
        } else {
          if (!isProjectId(workspaceId)) return
          input.workspaceId = workspaceId
        }
        const ticket = {}
        discovering.current.set(key, ticket)
        setDiscovery(workspaceId, { loading: true, issue: null })
        const finish = (entry, onProjects) => {
          if (discovering.current.get(key) !== ticket) return
          discovering.current.delete(key)
          setDiscovery(workspaceId, { ...entry, loading: false }, onProjects)
        }
        const fallback = projects ? 'projectsUnavailable' : 'statusesUnavailable'
        try {
          const result = await request(projects ? 'discover-projects' : 'discover-statuses', input)
          if (result?.ok !== true) return finish({ issue: discoveryError(result?.error?.code, projects, input.auto) })
          const data = projects ? decodeProjects(result.value) : decodeStatuses(result.value)
          if (!data) return finish({ issue: fallback })
          if (projects) {
            const issue = result.value.truncated === true || result.value.warning === 'truncated' ? 'projectsPartial'
              : !data.size ? 'projectsEmpty' : null
            const nick = result.value.currentNick
            if (input.auto && (result.value.scope !== 'participant' || typeof nick !== 'string' || !nick || nick.length > 128
              || nick.trim() !== nick || /[<>|;,\p{Cc}\u2028\u2029]/u.test(nick))) return finish({ issue: 'currentUserUnavailable' })
            finish({ data, issue, companyScope: result.value.scope === 'company' },
              input.auto && !fromLink ? old => !old.owner.trim() ? { ...old, owner: nick } : old : undefined)
          } else {
            finish({ data, issue: result.value.partial === true ? 'statusesPartial' : null })
          }
        } catch {
          finish({ issue: fallback })
        }
      }
      const updateProject = (id, key, value) => edit(old => ({
        ...old, projects: old.projects.map(project => project.id === id ? { ...project, [key]: value } : project),
      }))
      const cannotAdd = () => pending || reloadRequired || active.current || discovering.current.has('projects') || draft.projects.length >= MAX_PROJECTS
      const addManually = () => {
        if (cannotAdd()) return
        const id = nextId.current++
        edit(old => appendProject(old, id))
      }
      const add = () => {
        if (cannotAdd()) return
        const options = metadata.projects?.data
        if (options?.size && !projectOptionsLeft(draft, options)) return setDiscovery(undefined, { issue: 'allProjectsAdded' })
        const id = nextId.current++
        edit(old => appendChooser(old, id))
        if (!options?.size) return discover(undefined, draft.auth === 'basic' ? seedProject(draft.discoveryLink.trim()) : undefined)
      }
      const addFromLink = () => {
        if (cannotAdd()) return
        const seed = seedProject(draft.discoveryLink.trim())
        if (!seed) return setDiscovery(undefined, { issue: 'discoveryLinkInvalid' })
        if (!draft.projects.some(row => row.workspaceId === seed)) {
          const id = nextId.current++
          edit(old => appendProject(old, id, seed))
        }
        if (!metadata.projects?.data?.has(seed)) return discover(undefined, seed, true)
      }
      const remove = id => edit(old => ({ ...old, projects: old.projects.filter(project => project.id !== id) }))
      const submit = event => {
        event.preventDefault()
        if (!draft || pending || reloadRequired || active.current) return
        const prepared = prepareSave(draft, snapshot)
        if (prepared.error) {
          setPage(previous => ({ ...previous, atConnection: false, error: prepared.error, notice: null }))
          return
        }
        return run('save', prepared.input)
      }
      const saveCredentials = () => {
        if (pending || reloadRequired || active.current) return
        const { credentials, error } = prepareCredentials(draft)
        if (error) return setPage(previous => ({ ...previous, atConnection: true, error, notice: null }))
        if (credentials) return run('save-credentials', { expectedRevision: snapshot.revision, auth: draft.auth, credentials })
      }
      const reload = () => run('get', {})

      const catalog = snapshot?.catalog
      const workspaceListIssue = !catalog ? 'workspaceListUnavailable' : catalog.size === 0 ? 'noWorkspaces' : null
      const duplicateTitles = new Set()
      const seenTitles = new Set()
      for (const { title } of catalog?.values() ?? []) {
        if (seenTitles.has(title)) duplicateTitles.add(title)
        seenTitles.add(title)
      }
      const workspaceChoices = Array.from(catalog ?? [], ([id, { title, path }]) => [
        id, duplicateTitles.has(title) ? `${title} — ${path || id}` : title,
      ])
      const preventSubmit = event => { if (event.key === 'Enter' && !event.nativeEvent?.isComposing) event.preventDefault() }
      const discoveryIssue = key => key && h('p', { role: 'status', style: warning }, t(key))
      const projectFields = (project, index) => {
        const projectId = controlId(`project-${project.id}`)
        const projectField = (key, { label = t(key), ...options }) => h(Field, {
          id: `${projectId}-${key}`, label, value: project[key],
          onChange: value => updateProject(project.id, key, value), ...options,
        })
        const workspace = catalog?.get(project.targetWorkspaceId)
        const unknownTarget = !!project.targetWorkspaceId && !workspace
        const missingTarget = !!catalog && unknownTarget
        const workspaceHint = missingTarget ? t('missingWorkspaceHint') : workspace?.path
        const choices = [['', t('ungrouped')], ...workspaceChoices]
        if (unknownTarget) choices.push([project.targetWorkspaceId,
          t(catalog ? 'missingWorkspace' : 'unverifiedWorkspace', { id: project.targetWorkspaceId }), true])
        const currentName = projectNames?.get(project.workspaceId) ?? knownProjectNames?.get(project.workspaceId)
        const manualProjectInput = {
          type: 'text', inputMode: 'numeric', maxLength: 32, spellCheck: false, required: true,
          hint: !project.workspaceId ? t('manualProjectHint') : !currentName && knownProjectNames
            && project.lookupWorkspaceId === project.workspaceId && isProjectId(project.workspaceId) ? t('projectNameUnavailable') : undefined,
          onBlur: event => updateProject(project.id, 'lookupWorkspaceId', event.currentTarget.value),
          onKeyDown(event) {
            if (event.key !== 'Enter' || event.nativeEvent?.isComposing) return
            event.preventDefault()
            event.currentTarget.blur()
          },
        }
        const selectProject = value => {
          if (value === project.workspaceId) return
          edit(old => ({ ...old, projects: old.projects.map(row => row.id === project.id
            ? { ...row, workspaceId: value, lookupWorkspaceId: value, stories: '', tasks: '' } : row) }))
          if (!metadata.statuses.has(value)) void discover(value)
        }
        const taken = new Set(draft.projects.filter(other => other.id !== project.id).map(other => other.workspaceId))
        const projectChoices = Array.from(projectNames ?? [], ([id, name]) => [id, t('projectNamed', { id, name }), taken.has(id)])
        if (project.workspaceId && !projectNames?.has(project.workspaceId)) {
          projectChoices.unshift([project.workspaceId, currentName
            ? t('projectNamed', { id: project.workspaceId, name: currentName }) : t('savedProjectId', { id: project.workspaceId }), true])
        }
        const showPicker = !project.manualEntry && !!projectNames?.size
          && (!!project.workspaceId || projectChoices.some(([, , unavailable]) => !unavailable))
        const projectStatuses = metadata?.statuses.get(project.workspaceId)
        const types = ['stories', 'tasks']
        const renderStatuses = type => {
          const standard = type === 'tasks' && projectStatuses?.data?.useStandardTasks
          // Official /tasks status vocabulary; not project metadata and never preselected.
          const statuses = standard ? new Map([
            ['open', t('standardTaskOpen')], ['progressing', t('standardTaskProgressing')], ['done', t('standardTaskDone')],
          ]) : projectStatuses?.data?.[type]
          const selected = splitKeys(project[type])
          const issue = !standard && projectStatuses?.data?.issues[type]
          const unlisted = selected.filter(key => !statuses?.has(key))
          const labelCounts = new Map()
          for (const label of statuses?.values() ?? []) labelCounts.set(label, 1 + (labelCounts.get(label) ?? 0))
          return h('fieldset', { key: type, className: 'tapd-status-group' },
            h('legend', { style: labelStyle }, t(`${type}Choices`)),
            standard && h('p', { role: 'status', style: warning }, t('standardTaskHint')),
            issue ? discoveryIssue(issue) : !statuses?.size ? h('p', { style: message }, t('statusesEmpty')) :
              h('div', { className: 'tapd-status-choices' }, Array.from(statuses, ([key, label]) => h('label', { key },
                h('input', {
                  type: 'checkbox', value: key, checked: selected.includes(key), disabled: selected.length >= 32 && !selected.includes(key),
                  onChange: event => updateProject(project.id, type,
                    (event.currentTarget.checked ? [...selected, key] : selected.filter(value => value !== key)).join(', ')),
                }), h('span', null, labelCounts.get(label) > 1 ? t('statusNamed', { label, key }) : label),
              ))),
            unlisted.length > 0 && h('small', { style: message }, t('retainedStatuses', { count: unlisted.length })),
            unlisted.length > 0 && !standard && !issue && !!statuses?.size && h('button', {
              className: 'tapd-button', 'data-tone': 'quiet', type: 'button',
              onClick: () => updateProject(project.id, type, selected.filter(key => statuses.has(key)).join(', ')),
            }, t('removeUnavailableStatuses')),
          )
        }
        const summaries = types.map((type, i) => {
          const count = splitKeys(project[type]).length
          return count && t(i === 0 ? 'storyCount' : 'taskCount', { count })
        }).filter(Boolean)
        return h('div', { key: project.id, role: 'group', 'aria-labelledby': projectId, className: 'tapd-project' },
          h('div', { className: 'tapd-project-head' },
            h('div', null,
              h('h4', { id: projectId }, currentName || t('project', { number: index + 1 })),
              project.workspaceId && h('span', { className: 'tapd-project-code' }, `#${project.workspaceId}`),
            ),
            h('button', {
              type: 'button', className: 'tapd-button', 'data-tone': 'quiet',
              onClick: () => remove(project.id), 'aria-label': t('removeProject', { number: index + 1 }),
            }, t('remove')),
          ),
          h('div', { className: 'tapd-project-fields' },
            showPicker ? h(ProjectPicker, { t, id: `${projectId}-chooser`,
              name: currentName || (project.workspaceId ? t('savedProjectId', { id: project.workspaceId }) : ''),
              value: project.workspaceId, choices: projectChoices, onSelect: selectProject,
            }) : projectField('workspaceId', { ...manualProjectInput,
              onFocus: () => { if (!project.manualEntry) updateProject(project.id, 'manualEntry', true) },
            }),
            projectField('targetWorkspaceId', {
              choices, disabled: !project.targetWorkspaceId && !workspaceChoices.length, hint: workspaceHint, warn: missingTarget,
              'aria-describedby': [workspaceHint && `${projectId}-targetWorkspaceId-hint`, workspaceListIssue && controlId('workspace-hint')]
                .filter(Boolean).join(' ') || undefined,
            }),
          ),
          showPicker && h(Details, { title: t('manualProject'), annotation: project.workspaceId || undefined },
            projectField('workspaceId', manualProjectInput),
          ),
          h('div', { style: split },
            h('div', { className: 'tapd-chip-line', title: t('statusesHint') }, (summaries.length ? summaries : [t('noneSelected')])
              .map(text => h('span', { key: text, className: 'tapd-chip' }, text))),
            h('button', { type: 'button', className: 'tapd-button', 'data-tone': 'quiet',
              disabled: !isProjectId(project.workspaceId) || !!projectStatuses?.loading,
              onClick: () => discover(project.workspaceId) }, t(projectStatuses?.loading ? 'loadingStatuses'
                : (projectStatuses?.data || projectStatuses?.issue) ? 'refreshStatuses' : 'loadStatuses')),
          ),
          discoveryIssue(projectStatuses?.issue),
          projectStatuses?.data && h('div', { className: 'tapd-project-fields' }, types.map(renderStatuses)),
          isProjectId(project.workspaceId) && !projectStatuses?.loading && !projectStatuses?.issue && !projectStatuses?.data &&
            h('p', { className: 'tapd-project-advisory', style: message }, t('statusesHint')),
        )
      }
      const fieldFor = (key, label, options = {}) => h(Field, {
        id: controlId(key), label: t(label), value: draft[key], onChange: value => setField(key, value), ...options,
      })
      const password = key => fieldFor(key, key, {
        key, type: 'password', autoComplete: 'new-password', spellCheck: false, disabled: draft.useRefs,
        'aria-describedby': controlId('credential-hint'),
      })
      const officialLink = (url, key) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, t(key))
      const disabled = !!pending || !!reloadRequired
      const connectionFields = draft && h('div', { style: box },
        h('p', { id: controlId('credential-hint'), style: message }, t(draft.auth !== snapshot.auth
          ? 'authChangedHint' : snapshot.configured ? 'credentialsHint' : 'setupCredentialsHint')),
        h('div', { style: line }, fieldFor('auth', 'auth', {
          choices: [['bearer', t('bearer')], ['basic', t('basic')]],
          onChange: auth => edit(old => ({ ...old, auth, ...emptySecrets() }), 'credentials'),
          'aria-describedby': controlId('credential-hint'),
        })),
        h('div', { style: line }, draft.auth === 'bearer' ? password('token') : [password('apiUser'), password('apiKey')]),
        h('div', { style: line },
          h('button', { type: 'button', className: 'tapd-button', onClick: saveCredentials,
            disabled: disabled || !(draft.useRefs || (draft.auth === 'bearer' ? draft.token : draft.apiUser || draft.apiKey)),
          }, t(pending === 'save-credentials' ? 'savingCredentials' : 'saveCredentials')),
        ),
        atConnection && (error
          ? h('p', { role: 'alert', style: warning }, t(error))
          : notice && h('p', { role: 'status', style: message }, t(notice))),
        h(Details, { title: t('guide') }, draft.auth === 'bearer' ? h('div', { style: box },
          h('p', { style: message }, t('tokenStep')),
          h('div', { style: line }, officialLink(TOKEN_SETTINGS, 'openTokenSettings'), officialLink(TOKEN_GUIDE, 'tokenDocs'),
            officialLink(SUPPORT, 'supportGuide')),
        ) : h('div', { style: box },
          h('ol', { style: { margin: 0, paddingInlineStart: 24 } }, h('li', null, t('basicStep')), h('li', null, t('basicCopy'))),
          h('div', { style: line }, officialLink(API_GUIDE, 'applyGuide'), officialLink(BASIC_GUIDE, 'basicGuide')),
        )),
      )
      const refHint = controlId('refs-hint')
      const feedback = h('div', { className: 'tapd-feedback' },
        pending === 'get' && h('p', { role: 'status' }, t('loading')),
        !atConnection && error && h('p', { role: 'alert', style: { color: 'var(--dsw-alias-state-error-primary, #b4232b)' } }, t(error)),
        !atConnection && notice && h('p', { role: 'status' }, t(notice)),
        draft && !error && !notice && !pending && h('p', null, t('workspaceImpact')),
        (reloadRequired || error === 'workspaceUnavailable') && !pending && h('div', null, h('button', {
          type: 'button', className: 'tapd-button', onClick: reload,
        }, t(draft ? 'reload' : 'retry'))),
      )
      return h('section', { className: 'tapd-console', 'aria-labelledby': controlId('title') },
        h(ArcStyle),
        h('header', { className: 'tapd-hero' },
          h('div', { className: 'tapd-hero-title' },
            h('div', { className: 'tapd-route', 'aria-hidden': true }, h('span', null, 'TAPD'),
              h('svg', { viewBox: '0 0 24 13', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 },
                h('path', { d: 'M1 6.5h21 M17 2l5 4.5-5 4.5', strokeLinecap: 'round', strokeLinejoin: 'round' })),
              h('span', null, 'TAVLO')),
            h('h2', { id: controlId('title') }, t('title')),
            h('p', null, t('description')),
          ),
          draft && h('div', { className: 'tapd-control' },
            h(SyncSwitch, { label: t('enabled'), checked: draft.enabled, disabled, onChange: value => setField('enabled', value) }),
            h('div', { role: 'status' },
              h('span', { className: 'tapd-dot', 'data-ready': snapshot.syncState === 'ready', 'aria-hidden': true }),
              t('syncState'), ': ', h('strong', null, t(syncLabels[snapshot.syncState])),
            ),
          ),
        ),
        draft ? h('form', { noValidate: true, autoComplete: 'off', onSubmit: submit, 'aria-busy': !!pending },
          h('fieldset', { disabled, className: 'tapd-body' },
            h(Step, { id: controlId('connection-title'), number: '01', title: t('connectionStep'),
              actions: h('small', null, t(snapshot.configured ? 'configuredConnection' : 'none')) },
              h(Details, { title: t(snapshot.configured ? 'connection' : 'setupConnection'),
                annotation: snapshot.configured ? t(credentialLabels[snapshot.credentialSource]) : undefined,
                defaultOpen: !snapshot.configured,
              }, connectionFields),
              h('div', { className: 'tapd-connection-scope' },
                fieldFor('owner', 'owner', { type: 'text', maxLength: 128, spellCheck: false, required: draft.enabled }),

              ),
            ),
            h(Step, { id: controlId('projects-title'), number: '02', title: t('projectsStep'),
              actions: h('div', { className: 'tapd-step-actions' },
                h('span', { className: 'tapd-count' }, t('projectCount', { count: draft.projects.filter(row => row.workspaceId).length })),
                h('button', { type: 'button', className: 'tapd-button', disabled: draft.projects.length >= MAX_PROJECTS || !!projectDiscovery?.loading,
                   onClick: add }, t('addProject')),
              ) },
              h('p', { id: controlId('project-hint'), style: message, title: t('workspaceImpact') }, t('projectsHint')),
              workspaceListIssue && h('p', { id: controlId('workspace-hint'), style: catalog ? message : warning }, t(workspaceListIssue)),
              projectDiscovery?.loading && h('p', { role: 'status', className: 'tapd-project-advisory', style: message }, t('searchingProjects')),
              discoveryIssue(projectDiscovery?.issue ?? (projectNames?.size && !projectOptionsLeft(draft, projectNames) ? 'allProjectsAdded' : null)),
              projectDiscovery?.companyScope && h('p', { className: 'tapd-project-advisory', style: message }, t('companyProjectScope')),
              !draft.projects.length && h('p', { className: 'tapd-empty' }, t(draft.auth === 'bearer' && !draft.discoveryLink.trim()
                ? 'tokenProjectHelp' : 'noProjects')),
              draft.projects.map(projectFields),
              h(Details, { title: t('projectAlternatives'), annotation: seedProject(draft.discoveryLink.trim()) },
                h('div', { style: box },
                  fieldFor('discoveryLink', 'discoveryLink', { type: 'url', maxLength: 4096, placeholder: t('projectLinkPlaceholder'),
                    spellCheck: false, onKeyDown: preventSubmit, hint: t('discoveryLinkHint') }),
                  h('div', { style: line }, h('button', { type: 'button', className: 'tapd-button',
                    disabled: !draft.discoveryLink.trim() || draft.projects.length >= MAX_PROJECTS || !!projectDiscovery?.loading,
                    onClick: addFromLink,
                  }, t('useProjectLink')), h('button', { type: 'button', className: 'tapd-button',
                    disabled: draft.projects.length >= MAX_PROJECTS || !!projectDiscovery?.loading,
                    onClick: addManually,
                  }, t('addManually'))),
                ),
              ),
            ),
            h(Step, { id: controlId('range-title'), number: '03', title: t('rangeStep'),
              actions: h('small', null, t('rangeSummary')) },
              h(Details, { title: t('advanced'), annotation: draft.lookback
                ? t('lookbackPreset', { days: draft.lookback === 'custom' ? draft.lookbackDays : draft.lookback })
                : t('unrestricted') },
              h('div', { style: line },
                fieldFor('lookback', 'lookback', { hint: t('lookbackHint'), choices: [['', t('unrestricted')],
                  ...lookbackPresets.map(days => [days, t('lookbackPreset', { days })]), ['custom', t('custom')]],
                }),
                draft.lookback === 'custom' && fieldFor('lookbackDays', 'lookbackDays', { type: 'number', min: 1, max: 365, step: 1, required: true }),
              ),
              h('div', { style: line },
                fieldFor('intervalSeconds', 'interval', { type: 'number', min: 30, max: 86400, step: 1, required: true, hint: t('intervalHint') }),
                fieldFor('maxNewPerScope', 'maxNew', { type: 'number', min: 1, max: 1000, step: 1, required: true, hint: t('maxNewHint') }),
              ),
              snapshot.credentialSource === 'visual' && h('div', { style: { ...box, gap: 4 } },
                h('label', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } }, h('input', {
                  type: 'checkbox', checked: draft.useRefs, 'aria-describedby': refHint,
                  onChange: event => {
                    const useRefs = event.currentTarget.checked
                    edit(old => ({ ...old, useRefs, ...emptySecrets() }), 'credentials')
                  },
                }), t('useRefs')),
                h('small', { id: refHint, style: message }, t('useRefsHint')),
              ),
            ),
            ),
          ),
          h('footer', { className: 'tapd-actions' }, feedback,
            h('button', { type: 'submit', className: 'tapd-button', 'data-tone': 'primary', disabled },
              t(pending === 'save' ? 'saving' : 'save')),
          ),
        ) : h('div', { className: 'tapd-standalone-note' }, feedback),
      )
    }

    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }))
        const request = (operation, input, signal) => ctx.connection.rpc.call('/api', 'tavlo-tapd/settings', { operation, input }, signal)
        ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, key: PACKAGE, locale: NS },
          ({ t, view }) => view === 'page' ? h(SettingsForm, { t, request }) : null,
        ))
      },
    }
  },
})
