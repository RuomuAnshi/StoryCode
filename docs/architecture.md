# StoryCode 架构设计

> 版本：v1（Round 1 实现状态）
> 对应阶段：Phase 0 + Phase 1 + Phase 2（最小纵向功能链）

## 1. 设计目标与约束

StoryCode 是一款 AI 小说创作 IDE。架构需要同时满足四个彼此制约的目标：

| 目标 | 架构手段 |
| --- | --- |
| AI 能理解整个项目 | 分层上下文组装 + 检索（L0–L3） |
| AI 的改动必须可审核 | 一切写入经 Proposal → Commit，模型无直接写权限 |
| 用户正文永不丢失 | 版本哈希校验 + 提交前快照 + 回滚 |
| 模型与框架可替换 | `ModelClient` 接口 + 工具调用协议与具体模型解耦 |

硬约束（来自规格书与 `AGENTS.md`）：

- 核心模块 TypeScript 严格类型，禁止 `any`。
- AI 服务与文件操作、UI 解耦。
- 不允许把正文、API Key、聊天记录发往未授权第三方。
- 无网络时可阅读、编辑本地小说（AI 功能降级，写作功能不受影响）。

## 2. 分层结构

```
┌──────────────────────────────────────────────────────────────┐
│  apps/desktop — React 19 + Tailwind v4 + Zustand             │
│  UI 组件 / features / stores                                 │
│  UI 只依赖 ModelClient 与 ProjectStore 接口，不碰模型 SDK     │
└───────────────────────────┬──────────────────────────────────┘
                            │ invoke / listen（Tauri IPC）
┌───────────────────────────┴──────────────────────────────────┐
│  apps/desktop/src-tauri — Rust 壳                            │
│  文件系统桥接 / 路径越界校验 / 钥匙串 / 模型 SSE 代理          │
│  唯一持有项目根目录授权与 API Key 明文的地方                  │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────┴──────────────────────────────────┐
│  packages/agent — Agent Runtime                              │
│  ModelClient 适配层 │ 工具注册与派发 │ 上下文组装 │ Session    │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────┴──────────────────────────────────┐
│  packages/storage — 存储与事务                               │
│  FsAdapter │ ProjectStore │ SearchIndex │ Proposal │ Snapshot │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────┴──────────────────────────────────┐
│  packages/core — 纯类型与纯函数                              │
│  Zod schemas │ Markdown 往返 │ 路径安全 │ 字数 │ Diff          │
└──────────────────────────────────────────────────────────────┘
```

**依赖方向严格单向**，不得反向：

```
desktop → agent → storage → core
desktop → storage → core
desktop → core
validation → storage → core
```

`core` 不依赖任何包，也不引入 Node 内置模块（它会被打进 webview bundle）。需要 `node:fs` 的代码只能通过 `@storycode/storage/node-fs` 子路径引入，避免污染浏览器包。

## 3. 数据流：一次 AI 改稿的完整生命周期

这是整个架构最重要的路径，也是所有安全设计的汇聚点。

```
作者在右栏输入自然语言
        │
        ▼
AgentSession.run(request)
        │
        ├─ 1. Context Engine 组装上下文
        │     L0 项目规则（STORY.md）
        │     L1 当前任务（指令 / 选区 / 当前章节）
        │     L2 邻近剧情（前两章 + 大纲）
        │     L3 相关设定（检索命中 + 人物名册）
        │     超出 token 预算的条目记入 dropped，并在 UI 展示
        │
        ├─ 2. ModelClient.chat() —— 流式返回文本与 tool_calls
        │     Desktop 实现：Tauri 事件桥 → ChatCompletionStreamDecoder
        │
        ├─ 3. Tool Dispatcher
        │     校验 mode 白名单（ask 模式禁止一切写工具）
        │     校验参数（Zod schema.safeParse）
        │     执行工具 —— 读工具直接读盘；写工具只 push 到 pending[]
        │
        ├─ 4. 工具结果回填 messages，模型可自我纠正
        │
        ├─ 5. ProposalService.create(pendingChanges)
        │     ├─ 记录每个文件的 baseContentHash
        │     ├─ 捕获 previousContent（用于 Diff）
        │     └─ 写入 .storycode/proposals/<id>.json，不碰正文
        │
        ▼
   UI 渲染 ProposalCard + FileDiff（逐项接受 / 拒绝）
        │
        ▼
   ProposalService.commit(proposal, decisions)
        ├─ 版本校验：所有已接受变更重新比对哈希，不一致抛 VersionConflictError
        ├─ SnapshotStore.capture() 提交前快照
        ├─ 逐项写入，失败则回滚
        └─ 返回 CommitResult
        │
        ▼
   UI 刷新文件树 + 重建索引 + 打开新章节
```

**关键不变量：在第 5 步之前，磁盘上的小说文件没有任何变化。** 模型即使完全失控，也只能产出提案。

## 4. 各层职责

### 4.1 packages/core

纯函数与类型，无副作用、无 IO，可在任何环境运行。

| 模块 | 职责 |
| --- | --- |
| `schemas/` | Zod 定义：`CharacterCard`、`WorldSetting`、`CharacterRelationship`、`StoryFact`、`StoryEvent`、`ChangeProposal`、`ProjectMeta` 等 |
| `markdown.ts` | Frontmatter 解析/序列化，保证 `parse(serialize(x)).body === x.body` 字节级稳定 |
| `documents.ts` | 章节文档、角色文档、项目清单的读写转换 |
| `path-safety.ts` | `normalizeRelativePath`、`assertSafeName`、`joinProjectPath`；拒绝 `..`、绝对路径、控制字符、Windows 保留名 |
| `text.ts` | `countWords`：中文按字计、英文按词计，`total = cjkCharacters + words` |
| `diff.ts` | 统一 diff 生成 |
| `errors.ts` | `StoryCodeError` 错误码体系、`describeError` |

`PathTraversalError`、`VersionConflictError`、`NotFoundError` 等都在此定义，供所有层统一使用。

### 4.2 packages/storage

所有持久化操作都通过 `FsAdapter` 接口，这是可测试性的关键：

```ts
interface FsAdapter {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileStat>;
  readDir(path: string): Promise<DirEntry[]>;
  mkdirp(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  mtimeMs(path: string): Promise<number>;
  supportsAtomicReplace: boolean;
}
```

实现有两个：

- `NodeFsAdapter`：真实磁盘，通过 `@storycode/storage/node-fs` 引入。
- `MemoryFsAdapter`：内存实现，测试全程使用，因此在内存里模拟整个文件系统，测试既快又完全离线。

| 模块 | 职责 |
| --- | --- |
| `project-store.ts` | 项目创建/打开、章节 CRUD、文件读写（带 `expectedHash` 校验）、`buildTree`、`renameFile` |
| `search-index.ts` | 中文 n-gram 检索，返回 snippet + 行号 + 命中词 |
| `indexer.ts` | 索引维护、`recentChapters`、增量同步 |
| `proposal-service.ts` | 提案创建 / 提交 / 拒绝，版本门禁，快照与回滚 |
| `snapshot-store.ts` | 快照捕获与恢复，`expectedHashes` 防止覆盖作者新改动 |

**项目损坏的恢复策略：** `ProjectStore.open()` 在 `project.json` 缺失或损坏时，从 `STORY.md` 与目录结构重建清单，并把损坏文件保留为 `.storycode/manifest.corrupt.json`。Markdown 是权威来源，清单只是索引。

### 4.3 packages/agent

```
providers/          ModelClient 接口 + OpenAI 兼容实现 + Mock + SSE 解码器
tools/              24 个工具定义，按 mode 分类，参数用 Zod 校验
runtime/context.ts  分层上下文组装与 token 预算
runtime/session.ts  AgentSession：状态机、事件流、工具循环、提案生成
prompts/            系统提示词构建
```

**ModelClient 抽象**（`providers/types.ts`）：

```ts
interface ModelClient {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  chat(messages: readonly ModelMessage[], options: ChatOptions): AsyncIterable<ModelEvent>;
}
```

`ModelEvent` 是 `text-delta | tool-call | usage | error | done` 的联合类型。任何模型只要有适配器就能接入，`AgentSession` 不关心底层是 OpenAI、DeepSeek 还是本地 Ollama。

`DesktopModelClient` 是一个特殊实现：它不直接发 HTTP，而是通过 Tauri `invoke` 让 Rust 侧发起请求（因为密钥只存在于 Rust 侧），再把 SSE 原始文本通过事件流回传，由共享的 `ChatCompletionStreamDecoder` 解析。**与 fetch 实现共用同一个解码器**，保证两条路径行为一致。

**工具分组**（24 个）：

| 组 | 工具 |
| --- | --- |
| 文件 | `list_project_files`、`read_project_file`、`search_project_files` |
| 写入（仅提案） | `propose_create_file`、`propose_edit_file`、`propose_delete_file` |
| 联网研究 | `web_search`、`web_fetch`（默认关闭，只读） |
| 作者决策 | `ask_user`（结构化选项，等待输入） |
| 角色工作流 | `propose_character_cards`、`propose_character_update`、`get_relationships` |
| 世界观工作流 | `propose_world_directions`、`propose_world_setting`、`propose_world_update` |
| 小说 | `get_chapter`、`list_chapters`、`get_recent_chapters`、`get_character`、`list_characters`、`get_world_setting`、`get_story_rules`、`get_editor_selection` |

文件变更工具的实现只向 `ToolContext.pending[]` 推入记录，交由 ProposalService 审核提交；世界观候选工具返回候选事件。当前 ToolContext 持有 ProjectStore，因此这项约束由工具实现与测试保证，尚未从类型层移除底层写能力。

**模式白名单：**

- `ask`：只允许只读工具。模型若强行调用 `propose_*`，返回 `PERMISSION_DENIED`，错误回填给模型。
- `plan` / `agent`：允许全部工具，但写操作仍然只是提案。

**AgentSession 状态机：**

```
idle → planning → retrieving → generating → validating
     → awaiting_review → committing → completed
                                     ↘ failed / cancelled
```

每步都通过 `AgentEvent` 推送给 UI，因此用户能实时看到"正在读取文件""正在生成""等待审核"。取消通过 `AbortController` 贯穿到模型请求与工具执行。

### 4.4 apps/desktop

```
features/
  explorer/   文件树、项目创建/打开、新建章节
  editor/     Tiptap 编辑器、Markdown 往返、自动保存、冲突处理
  agent/      对话、计划步骤、工具调用、引用、输入框
  review/     提案卡片、文件 Diff、逐项接受
  search/     快速搜索面板
  settings/   模型配置
stores/       workspace / editor / agent / settings（Zustand）
lib/          Tauri 桥接、ModelClient、路径工具、主题、可调宽
```

**状态管理边界：**

- `workspace-store`：当前项目以及 `ProjectStore` / `ProjectIndexer` / `ProposalService` / `SnapshotStore` 实例。
- `editor-store`：当前文档、草稿、保存状态、冲突检测、字数。
- `agent-store`：对话轮次、流式文本、计划、工具调用、当前提案。
- `settings-store`：模型配置（**不含密钥**）、密钥状态。

`AgentSession` 实例存放在模块级变量而非 Zustand 中——它持有 `AbortController`，不该被 React 的渲染周期管理。

**自动保存与冲突：** 编辑停止 900ms 后自动保存；保存前重新读取文件哈希与 `baselineHash` 比较，不一致则弹出冲突横幅让用户选择"覆盖"或"重新载入"，绝不静默覆盖。

### 4.5 apps/desktop/src-tauri（Rust 壳）

Rust 侧是唯一的特权层：

| 模块 | 职责 |
| --- | --- |
| `paths.rs` | `normalize_relative` / `resolve_within`，拒绝越界与符号链接逃逸 |
| `fs_commands.rs` | 文件读写、目录列举、哈希、批量读取；原子写入带 exFAT 回退 |
| `secrets.rs` | 系统钥匙串读写；`load_api_key` 不是 command，webview 无法读取明文 |
| `model_proxy.rs` | 代理模型请求：注入密钥、流式转发 SSE、支持取消 |
| `state.rs` | 项目根目录、活动流表 |

**为什么密钥在 Rust 侧？** 如果密钥进入 webview，任何 XSS 或恶意依赖都能读走它。现在密钥只在 Rust 进程内存中出现，前端只能拿到 `configured` 与 `hint`（后四位）。

**取消模型请求：** 每个流有唯一 `request_id`，`streams` 表保存 `watch::Sender<bool>`；`cancel_chat` 触发后 `tokio::select!` 中断流并发出 `model://cancelled`。

## 5. 数据模型

### 5.1 项目布局

```
MyNovel/
├── STORY.md              项目规则：简介、主题、写作规则（L0 上下文）
├── project.json          元数据清单（可重建）
├── chapters/001.md       正文
├── characters/*.md       角色卡（Frontmatter + Markdown）
├── world/*.md            世界观
├── plot/*.md             大纲、时间线、关系、伏笔
└── .storycode/
    ├── proposals/        待审核提案
    ├── snapshots/        快照
    ├── conversations/    （Phase 2 预留）
    └── logs/
```

所有正文与设定都是 Markdown + YAML Frontmatter，用户可以用任何编辑器打开。`id` 存在于 Frontmatter，因此**改文件名不会改变实体 ID**。

### 5.2 设定可信度

```
user_confirmed   用户明确确认
source_confirmed 已在正式正文确立
ai_proposed      AI 提出，作者未确认
inferred         从已有内容推导
rejected         作者否决
superseded       被新版本取代
```

代码层面强制：`ai_proposed` / `inferred` 不得升级为确定事实；与正文冲突时不得静默覆盖。这是 Phase 3/4 的核心约定，Schema 已就绪。

### 5.3 提案模型

```ts
interface FileChange {
  id: string;
  operation: 'create' | 'update' | 'delete';
  filePath: string;
  baseContentHash: string | null;   // 创建时为 null
  nextContent: string;              // delete 时为空串
  previousContent: string | null;   // 用于 Diff
  summary: string;
  kind: 'chapter' | 'character' | 'world' | 'plot' | 'other';
}
```

`baseContentHash` 是整个并发安全的基础：提案在 T1 时刻记录文件状态，提交在 T2 时刻校验；中间作者的任何编辑都会导致哈希不匹配而拒绝提交。

## 6. 上下文与检索

### 6.1 分层预算

按优先级填充，超预算记录 `dropped` 并在 UI 显示"因超出预算未包含"：

1. 系统与安全规则（永不裁剪）
2. 用户当前指令（永不裁剪）
3. 显式引用文件
4. 项目硬规则 `STORY.md`
5. 当前章节 + 邻近章节
6. 相关角色与世界观
7. 检索补充结果

`estimateTokens` 对中文按约 1 token/字计（CJK Unicode 区判定），对拉丁文本按 0.25 token/字符计。

### 6.2 中文检索

中文不能用空格分词，因此采用 **CJK 单字 + 二元组** 混合索引：

- 二元组（如「林岚」）权重高，是主要命中来源。
- 单字权重低，只用于补充召回。
- **若查询中所有命中都只来自单字，则该文档不计入结果。** 这避免了「的」这类高频字把全部文件拉进结果——这是实现中发现并修复的真实 bug。
- 片段选取围绕最佳命中行，且标题行降权，避免"只返回标题"。

检索结果必须带 `path`、`startLine`、`endLine`、`matchedTerms`，UI 据此展示引用来源，用户可以看到 AI 为什么引用了某个文件。

## 7. 安全性

| 威胁 | 防御 |
| --- | --- |
| AI 改坏正文 | 提案 + 版本校验 + 快照 + 回滚 |
| AI 越权访问文件 | Rust 侧路径规范化 + `starts_with(root)` 校验 |
| 路径穿越 | 拒绝 `..`、绝对路径、控制字符、Windows 保留名 |
| 符号链接逃逸 | `canonicalize` 后比对真实路径 |
| 密钥泄露 | 仅存钥匙串；明文永不出 Rust 进程 |
| AI 执行命令 | 不提供任何 Shell 工具 |
| XSS | Tauri CSP 限制 `script-src 'self'` |
| 静默覆盖用户改动 | 哈希门禁 + 快照守卫 |
| 伪造成功 | 提案与提交严格分离；UI 只渲染真实 `CommitResult` |

## 8. 已知限制（Round 1）

以下为**尚未实现**，不是"基本可用"：

- SQLite 持久化索引：当前索引在内存中，启动时重建。20 万字项目重建需要时间（Phase 6 解决）。
- Embedding / 向量检索：只有字面检索（Phase 6）。
- 角色卡：已接入结构化提案、来源与局部字段更新；完整分阶段语义提取、字段确认及旧卡迁移仍待实现。世界观已接入候选选择与结构化细化的最小闭环（Phase 4）；已有世界观支持未确认草稿的八类列表区块局部更新，引用 / 文字匹配影响报告接入审核及提交复核；已确认设定冲突、方向重构及完整语义依赖分析仍未实现。
- 连续性检查：`packages/validation` 已有 schema 与引用校验骨架，硬冲突检测未完成（Phase 8）。
- 行内 Diff：当前是文件级 Diff（Phase 7 做选区行内 Diff）。
- Windows 打包：未在真实 Windows 环境验证。
