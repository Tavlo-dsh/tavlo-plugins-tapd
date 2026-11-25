# Tavlo TAPD 桥接

`@tavlo-dsh/dsh-plugin-tapd` 是一个**带可视化设置的后台桥接插件**，不另做看板。它通过 TAPD 官方 [`GET /stories`](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/story/get_stories.html) 和 [`GET /tasks`](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/task/get_tasks.html)，把符合筛选条件的需求、任务追加到现有 Tavlo「任务」看板。不需要另装 Task Hub。

需要 DSH `0.2.2-rc.1`、Node.js 24+，以及当前 profile 中启用的 Tavlo 任务看板（`TaskService` v1，支持精确来源查询和唯一来源）。安装后桥接默认不运行，不读取 TAPD，也不建卡。

## 安装与配置

```sh
npm ci
npm test
npm pack
dsh plugin --profile web add ./tavlo-dsh-dsh-plugin-tapd-0.5.0.tgz
```

### 在 DSH 界面配置（推荐）

1. 打开侧栏 **插件 → 已安装插件 → @tavlo-dsh/dsh-plugin-tapd**，在插件详情里找到 **TAPD 同步设置**。更新安装后如果宿主提示需要重启，先重启再打开页面。
2. 在连接设置中输入 **个人访问令牌**，或切换成 **企业 API 账号 + 口令**。个人令牌见 TAPD **我的 → [个人访问令牌](https://www.tapd.cn/personal_settings/index?tab=personal_token)**；企业版公司管理员从 **公司管理 → 开放集成 → API 账号管理** 获取 [API 账号和口令](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/API%E9%85%8D%E7%BD%AE%E6%8C%87%E5%BC%95.html)，不是登录密码。已配置凭据时不必再次输入，浏览器不会从 Host 读回凭据原文。要换令牌，在「TAPD 连接」填入新值并点 **保存凭据**；这不会保存项目、处理人或同步范围的草稿，也不需要等待项目查询。
3. **个人令牌**填好后直接点 **添加项目**，无需先保存凭据。项目表单会先出现，可以立即输入项目 ID；也可以等待后台读取项目列表后按名称或 ID 选择。Host 会尝试通过 [当前用户接口](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/user/get_users_info.html) 识别令牌持有人，再读取其 [参与项目](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/workspace/user_participant_projects.html)，可直接在 **TAPD 项目** 控件内按名称或 ID 搜索并选择。处理人留空时会用识别出的昵称填入，不覆盖已有处理人。TAPD 对令牌类型和枚举权限可能有限制；如果自动读取失败，可在 **选择同步项目 → 其他添加方式** 粘贴链接并点 **从链接添加**，或手动添加项目 ID。企业 API 账号的列表查询仍需要公司上下文，可用已有公司设置或项目链接。已有凭据时，设置页会按 ID [读取已保存项目的名称](https://open.tapd.cn/document/api-doc/API%E6%96%87%E6%A1%A3/api_reference/workspace/get_workspace_info.html)，不依赖项目列表。手动输入的新 ID 在按回车或离开输入框后查询；名称显示在卡片标题上，ID 保留用于核对。如果凭据没有读取项目信息的权限，仍可用 ID 配置同步。读取项目和状态不会保存草稿凭据，也不会导入工作项。
4. 选择 **DSH 工作区**，再按 TAPD 显示名称勾选需求、任务状态。通过项目选择器选中项目时会自动读取状态；已有项目可以点 **读取可选状态**。有一类状态读不到时，另一类仍可选择；读取失败不会清除已保存的选项。某些项目未提供可读取的任务状态时，可以手动勾选界面注明的 TAPD 标准任务状态；这不表示已验证任务读取权限。若 TAPD 明确拒绝访问，请检查令牌的项目读取权限或联系管理员，再点 **重新读取状态**。没有选状态的类型不导入。**高级设置 → 同步时间范围** 可按 TAPD 最后更新时间限制新导入，只需要覆盖近期工作项时建议先选择近 7 天或 30 天。
5. 打开 **启用 TAPD 同步**，点击 **保存设置**。保存后无需重启；已有同步先停止旧轮次，再按新设置运行。开关关闭时可先保存配置，不启动导入。

已保存的界面设置优先于 profile 中对应字段；初次使用仍会显示现有 YAML 配置，凭据引用名称仍由 profile 控制。「已配置凭据」表示 Host 有可用格式的值，**不表示已经在 TAPD 通过鉴权**。同步只在 Host 上后台运行。

### YAML 配置（未使用界面保存时）

将 [配置示例](tapd.example.patch.yml) 的条目添加到当前 profile 的 `$DSH_HOME/profiles/web/cordis.patch.yml` 列表中。若文件是 `[]`，则以这一条目替换空列表；若已有内容，不覆盖其他条目。替换项目 ID（带引号的字符串）、准确的 TAPD 处理人昵称和状态值。`stories` 或 `tasks` 留空表示不同步该类型；至少一个类型须填。需求流程可按项目定制，填写 TAPD API 返回的 `status` Key 而非中文显示名；示例里的 `planning` 不保证适合你的项目。独立任务的官方默认状态包括 `open`、`progressing` 和 `done`。

- **个人令牌**：`auth: bearer`，默认凭据引用 `TAVLO_TAPD_TOKEN`。
- **企业 API 账号 + 密钥**：`auth: basic`，默认引用 `TAVLO_TAPD_API_USER` 和 `TAVLO_TAPD_API_KEY`。这是 TAPD 的 API 账号，不是登录密码。
- 将真实值存入 DSH Credentials（本地默认 `$DSH_HOME/.credentials.yaml` 的 `refs` 映射；保留 `version: 1` 和已有项）；也可由 **启动 DSH Host 的环境**提供这些变量。不要把密钥写进 profile、仓库，也不要发给 Agent。启动环境的改动需 Host 重新启动；默认本地凭据文件支持热重载。

确认筛选范围后，将 `enabled` 改为 `true`。当前 Web profile 有 HMR 时会应用配置，否则需要重启该 Host。配置生效后先跑一轮，完成后默认等 300 秒再跑；`intervalSeconds` 可设 30–86400。设回 `false` 或从 DSH 插件页停用即可暂停。请只让一个使用同一 DSH 数据目录的 Host 运行桥接。

## 同步规则

- 每个 TAPD 项目可选一个 DSH 工作区，项目内新导入的需求和任务使用同一归属。不选工作区时进入「未分组」；工作区被删除时，该项目的新导入等待修正映射，不会自动落到「未分组」。改映射只影响尚未建立导入记录的新工作项，不迁移已有任务，待确认的重试仍使用原归属。YAML 中相应字段为 `targetWorkspaceId`。
- 只同步配置中明确选中的项目和状态，再逐条核验匹配的处理人，不会因为条件缺失而查询所有人。设置 `lookbackDays`（1–365）时，以北京时间（UTC+8）的 TAPD 最后更新时间计算最近 N 天，同步轮次内统一使用同一时间范围；不设则不限时间。每个项目/类型独立扫描，100 条/页、最多 10 页。扫描不完整，或待新增超过 `maxNewPerScope`（默认 25，可设 1–1000），该范围本轮不写卡。先收窄项目、状态或时间，确认后再提高上限。
- 新卡进入默认「待开始」，保存标题、转换为安全 Markdown 文本的描述、可点开的 TAPD 原链接和有效的截止日。不会同步图片、附件、优先级或 TAPD 状态，不启动 AI。
- **只新增一次，不覆盖，不回写。** 原工作项更新、关闭、转派或删除，不动本地任务。已导入本地卡被编辑、移动、删除或解除来源关联，桥接都不会覆盖或重建它。不要清理桥接回执来触发重建；卸载不清除回执和已建任务。
- 连接 UUID、待确认的建卡输入和轻量回执在独立的 `tavlo_tapd_bridge` 存储域。写入未确认时，仅在远端仍符合筛选时尝试重放原输入。采用配置是长期单向拉取，不要求保持浏览器页面打开。
- 同步结果在 Host 日志里，以 `tavlo-tapd:` 开头。`created` 为新建数，`duplicates`/`suppressed` 表示已见过、不再建；`scope-limit` / `scan-limit` 是本轮安全上限，`missing-credentials` / `auth` 可检查配置引用、凭据权限和项目。`rate-limit` 在本轮停止继续请求，遵循 TAPD 的 Retry-After。日志不输出凭据和工作项内容。

TAPD 文本由第三方提供；若后来从任务卡主动启动 Agent，请先查看导入内容。桥接不会把原始 HTML 渲染为页面或自动加载远端资源。

## 验收

先只配置一个真实项目和一个状态，确认任务板中出现预期卡片、来源链接打开正确，且下一轮不重复。改一个本地卡标题或删除一张已确认不再需要的卡，确保下一轮不覆盖或重建。测试使用模拟 TAPD，不需要企业凭据；两种认证及需求／任务在各自有权限的真实项目中分别验收。

TAPD 客户端借鉴 [dsh-task-hub 0.7.5](https://github.com/handsomeboy65/dsh-task-hub/tree/053282f1fe1a79bb257439926c3af06b3ef5f0a1) 的 MIT 代码。个人令牌项目枚举的接口组合参考了 [dsh-plugin-tapd 0.1.0](https://www.npmjs.com/package/dsh-plugin-tapd/v/0.1.0)。桥接不包含这些项目的独立页面、工具或其他集成功能。
