# StoryCode

**像使用 Cursor / Codex 写代码一样写小说。**

StoryCode 是一款 AI 小说创作 IDE。你用自然语言描述人物、世界观和修改要求，AI Agent 负责读取项目里的真实文件、生成结构化设定、续写正文，并把每一处改动作为**可审核的变更提案**交给你确认——只有你点了确认，文件才会真正写入磁盘。

> 当前状态：**第一轮（Phase 0 + Phase 1 + Phase 2）已完成并验证**。
> 角色生成、世界观构建等能力按阶段推进，详见 [docs/progress.md](docs/progress.md)。

## 它解决什么问题

聊天式写作工具的问题是：聊完就忘了，设定的、改的东西散落在对话里，几十章之后无法维护。

StoryCode 把小说当成一个**工程**：

- 正文与设定都是本地 Markdown 文件，你随时可以用任何编辑器打开、用 Git 版本管理。
- 角色卡、世界观、关系、时间线是**带 Schema 的结构化数据**，不是散文段落。
- AI 只能提出变更提案（增 / 改 / 删哪些文件、具体改成什么），由你逐项接受或拒绝。
- 提交前有版本校验和自动快照，AI 永远不会覆盖你正在写的段落。

## 核心特性（第一轮）

| 能力 | 状态 |
| --- | --- |
| 三栏界面：文件树 / 正文编辑器 / AI Agent | ✅ 已实现 |
| 新建本地小说项目（自动建立目录结构） | ✅ 已实现 |
| 章节新建、打开、编辑、自动保存 | ✅ 已实现 |
| 字数统计、保存状态、中英文混排计数 | ✅ 已实现 |
| Markdown 往返无损（保存再打开不丢格式） | ✅ 已实现，有测试保障 |
| 中文全文检索（bigram 分词） | ✅ 已实现 |
| 模型配置（OpenAI 兼容 / DeepSeek / Moonshot / Ollama） | ✅ 已实现 |
| API Key 存入系统钥匙串，前端拿不到明文 | ✅ 已实现 |
| Agent 流式回复、执行步骤、工具调用可视 | ✅ 已实现 |
| Agent 生成章节提案 → 审核 → 写入真实文件 | ✅ 已实现 |
| 单向接受 / 拒绝、全部接受 / 拒绝 | ✅ 已实现 |
| 运行中停止、失败重试 | ✅ 已实现 |
| 世界观与项目信息预览 | ✅ 世界观字段与 Markdown 正文、project.json 可读信息及原文查看 |
| 设定文件编辑 | ✅ 人物 / 世界观 / 关系 Markdown 源码编辑、校验、保存前快照与预览切换 |
| 人物关系图 | ✅ 有向关系、确认状态、双方视角、缩放及原文切换（只读） |
| 联网搜索与网页阅读 | ✅ 默认关闭的联网开关、DuckDuckGo 搜索、公开网页文字与来源链接 |
| 深色 / 浅色主题、侧栏折叠与调宽 | ✅ 已实现 |
| 角色卡生成 | 🚧 结构化多人物/关系提案、来源表及局部更新；完整验收进行中 |
| 世界观构建 | 🚧 三候选 → 作者选择 → 结构化提案 → 审核保存已实测；持续修改等未完成 |
| 连续性检查、行内 Diff 改稿 | ⬜ 后续阶段 |

## 快速开始

### 环境要求

- Node.js ≥ 20（开发使用 Node 24）
- pnpm 10+
- Rust 1.77+ 与 Tauri 2 的系统依赖（macOS 需要 Xcode Command Line Tools）

### 开发模式

```bash
pnpm install          # 安装依赖
pnpm dev              # 只启动前端（浏览器调试 UI）
pnpm dev:tauri        # 启动完整桌面应用（推荐）
```

### 验证

```bash
pnpm typecheck        # tsc -b，必须 0 error
pnpm test             # vitest run，229 个测试
pnpm lint             # eslint，0 warning
pnpm build            # 前端构建
```

### 首次使用

1. 启动应用，选择「新建小说」，在文件选择器里挑一个目录并给小说起名（例如《示例小说》）。
2. 点右上角 ⚙️ **设置**，选择模型服务商，填入 Base URL、模型 ID 和 API Key（Key 会存进系统钥匙串）。
3. 在右侧输入框里描述你想写的内容，例如：
   > 根据当前项目设定，规划第一章
4. Agent 会读取项目上下文、调用工具、生成**章节提案**。你可以在提案卡片里看到将新建的文件和完整正文。
5. 点「接受并写入」——章节出现在左侧文件树、正文出现在中央编辑器，并且已经真实保存为 `chapters/001.md`。

## 项目结构

```
apps/desktop/          Tauri 2 + React 19 桌面应用
  src/                 UI：components / features / stores / lib
  src-tauri/           Rust：文件系统桥接、密钥、模型 SSE 代理
packages/core/         纯类型与纯函数：Schema、Markdown、路径安全
packages/storage/      FsAdapter、ProjectStore、检索索引、提案、快照
packages/agent/        模型适配、工具集、上下文组装、AgentSession
packages/validation/   连续性 / 时间线 / 引用校验（骨架）
tests/                 fixtures / integration / e2e
docs/                  架构、计划、决策、进度
```

依赖方向是单向的：`desktop → agent → storage → core`。UI 不碰模型 SDK，模型层不碰文件写入。

## 小说项目的磁盘结构

```
MyNovel/
├── STORY.md              项目说明与写作规则
├── project.json          项目元数据
├── chapters/001.md       正文，一篇一章
├── characters/           角色卡
├── world/                世界观
├── plot/                 大纲、时间线、关系、伏笔
└── .storycode/           提案、快照、日志（内部数据）
```

全部是普通 Markdown 文件（元数据放在 YAML Frontmatter 里）。**你可以直接用 VS Code 编辑，也可以用 Git 管理版本。**

## 安全设计

- **AI 不能直接写文件。** 工具层只有 `propose_create_file` / `propose_edit_file` / `propose_delete_file`，写盘必须经过你确认。
- **API Key 不进前端。** 密钥存在系统钥匙串，只有 Rust 侧在发起请求时读取；webview 只能拿到 `••••1234` 这样的提示。
- **路径全量校验。** 拒绝 `..`、绝对路径、符号链接逃逸和受保护文件。
- **不伪造结果。** 没写入就是没写入，模型不支持工具调用时会明确提示能力受限，而不是假装改了文件。

## 文档

- [AGENTS.md](AGENTS.md) — 开发约定（文件安全规则、TS 规范、测试要求）
- [docs/architecture.md](docs/architecture.md) — 架构设计
- [docs/implementation-plan.md](docs/implementation-plan.md) — 分阶段实施计划
- [docs/decisions.md](docs/decisions.md) — 关键技术决策与原因
- [docs/progress.md](docs/progress.md) — 当前进度与已知问题

## 许可证

私有项目，尚未选择开源许可证。
