# AGENTS.md — StoryCode 开发约定

本文件是所有参与 StoryCode 开发的 AI Agent 与人类贡献者的行为准则。开始任何改动前请先读本文件。

## 1. 产品目标

StoryCode 是一款 **AI 小说创作 IDE**：像用 Cursor / Codex 写代码一样写小说。

用户用自然语言描述人物、世界观、故事与修改要求，AI Agent 负责组织项目文件、生成结构化设定、续写正文、重构章节并检查连续性。产品价值不在于"聊天式写作"，而在于：

1. **项目理解**——AI 读取的是项目里的真实文件，而不是一次性的上下文粘贴。
2. **结构化设定**——角色卡、世界观、关系、时间线都是可校验的数据，而不是散文。
3. **可审核的文件编辑**——AI 只能提出变更提案，由作者逐项确认后才落盘。
4. **长期连续性维护**——几十万字之后仍能定位事件、引用原文、发现矛盾。

## 2. 界面原则：极简

- 三栏结构：左文件树、中正文编辑器、右 AI Agent。底栏状态信息。
- 用户打开软件 **第一眼看到的是小说**，不是配置向导。
- 风格参照 Linear × Apple Pro：克制、留白、阅读优先。中文界面优先。
- 不使用仪表盘、不堆砌配置面板。侧栏可折叠、可调宽，聚焦模式隐藏全部侧栏。
- **禁止**提前搭建"以后可能会用"的界面。没有真实功能的入口一律不加。

## 3. 文件安全规则（最高优先级）

> **用户的小说正文是这个项目的最高价值，任何代码正确性都不能以损坏正文为代价。**

1. **AI 永远不能直接写文件。** 所有写入必须经过 `ProposalService`：生成 `ChangeProposal` → 作者审核 → `commit()`。工具层只能调用 `propose_*`。
2. **Markdown 文件是人类可编辑的权威来源。** SQLite/索引都是可重建的缓存，损坏时从 Markdown 重建，绝不反向覆盖。
3. **写入前版本校验。** 每个变更在创建时记录 `baseContentHash`，提交时重新校验；不一致就抛 `VersionConflictError`，绝不静默覆盖作者正在编辑的内容。
4. **提交前自动快照。** `ProposalService.commit()` 必须调用 `SnapshotStore.capture()`；中途失败要能回滚到一致状态。
5. **路径必须校验。** 所有路径经 `normalizeRelativePath` / `resolveWithIn` 处理，拒绝 `..`、绝对路径、符号链接逃逸、受保护文件（`project.json`、`.storycode/`）。
6. **不得伪造写入结果。** 没写就说没写；失败了就报错。禁止把"计划写入"渲染成"已写入"。

## 4. 设定确认规则

StoryCode 区分"用户说的"、"正文写的"和"AI 猜的"，三者不可混淆：

- `user_confirmed` / `source_confirmed`：可以当作确定事实使用。
- `ai_proposed` / `inferred`：**只能作为建议**，不得升级为既定设定，不得在后续生成中当作已知事实引用。
- `rejected`：作者已否决，不要无缘无故重复提出。
- `superseded`：被新版本取代，保留变更链。

冲突时生成候选方案交由作者选择，**不要自作主张**。与正式正文冲突时不允许静默覆盖，必须保留变更记录。

## 5. TypeScript 规范

- **严格模式，项目已开启** `strict` / `noUncheckedIndexedAccess` / `noImplicitOverride` / `noImplicitReturns` / `noUnusedLocals` / `verbatimModuleSyntax`。
- **禁止 `any`。** ESLint 规则 `@typescript-eslint/no-explicit-any: error`。不确定的类型用 `unknown` 再收窄。
- 导入类型时用 `import type`（`consistent-type-imports` 强制）。
- 所有跨模块边界的数据结构用 **Zod schema** 定义并导出推断类型，不要手写两份。
- AI 生成的结构化结果（角色卡、世界观、提案）**必须**经过运行时 Schema 校验才允许进入项目。
- 类型检查命令：`npx tsc -b tsconfig.json`，必须 0 error。

## 6. 测试要求

- 任何新功能都要配套测试；修 bug 先写能复现的测试。
- **禁止用真实付费模型跑测试。** 使用 `MockProvider` + `ScriptedTurn` 脚本化响应，测试必须可重复、可离线。
- 覆盖分层：
  - 单元测试：schema 校验、Markdown 往返、路径安全、ID 稳定性、冲突判定、上下文预算、ChangeSet 提交与回滚。
  - 集成测试：Agent → 工具 → 提案 → 提交全链路；取消、超时、断网、无效 JSON。
  - 端到端：`tests/e2e/acceptance.test.ts` 必须覆盖首轮验收场景。
- 命令：`npx vitest run`。提交时要求全绿。
- 若某项功能没有真正实现，**必须在 docs/progress.md 中明确标记为未完成**，不得用"基本可用"模糊描述。

## 7. 项目结构约束

```
apps/desktop/           Tauri 2 + React 19 桌面应用
  src/                  UI（组件、stores、features）
  src-tauri/            Rust 壳：文件系统桥接、密钥、模型 SSE 代理
packages/core/          纯类型与纯函数：schemas、entities、markdown、路径安全
packages/storage/       FsAdapter、ProjectStore、索引、提案、快照
packages/agent/         模型适配、工具、上下文组装、AgentSession
packages/validation/    连续性 / 时间线 / 引用校验
tests/                  fixtures、integration、e2e
docs/                   架构、计划、决策、进度
```

**依赖方向（不得反向）：**

```
desktop → agent → storage → core
desktop → storage → core
desktop → core
validation → storage → core
```

强制约束：

- `core` 不得依赖任何其他包，且不得引入 Node 内置模块（它会进 webview bundle）。
- UI 不得直接调用模型 SDK；必须经过 `ModelClient` 接口。
- 模型 Provider 不得直接写小说文件；只能通过工具 + 提案。
- `node:fs` 实现只能通过 `@storycode/storage/node-fs` 子路径引入，避免进入浏览器包。

## 8. 阶段开发要求

严格按 `docs/implementation-plan.md` 的阶段顺序推进（Phase 0 → 9）：

1. 每个阶段必须有**可运行的成果**，不允许只交付不能工作的 UI。
2. 不提前实现未来阶段的功能，但**预留数据接口**。
3. 每阶段完成后依次执行：`lint` → `tsc` → `test` → `build`，然后更新 `docs/progress.md`，并在 `docs/decisions.md` 记录关键技术决策与原因。
4. 汇报时区分"已实现并验证"与"未实现"，**不允许夸大**。

## 9. 安全与隐私

- API Key 只能存系统钥匙串（keyring），不得写入配置文件、日志、错误堆栈或前端状态持久化。
- 密钥读取发生在 Rust 侧，webview **永远拿不到明文密钥**。
- 不允许 AI 执行 Shell 命令。
- 不把用户正文、密钥、聊天记录发送到未授权第三方。
- 无网络时仍能阅读和编辑本地小说。
- 所有遥测默认关闭。
