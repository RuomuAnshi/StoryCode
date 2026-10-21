import { z } from 'zod';
import {
  DIRS,
  StoryCodeError,
  excerpt,
  normalizeRelativePath,
  parseMarkdown,
  type Citation,
} from '@storycode/core';
import {
  defineTool,
  type PendingFileChange,
  type ToolDefinition,
  type ToolOutcome,
} from './types.js';

const FilePathArg = z.string().min(1).max(500);

function kindFromPath(path: string): PendingFileChange['kind'] {
  if (path.startsWith(`${DIRS.chapters}/`)) return 'chapter';
  if (path.startsWith(`${DIRS.characters}/`)) return 'character';
  if (path.startsWith(`${DIRS.world}/`)) return 'world';
  if (path.startsWith(`${DIRS.plot}/`)) return 'plot';
  return 'other';
}

export const listProjectFilesTool = defineTool({
  name: 'list_project_files',
  description:
    '列出小说项目中的所有文件（章节、角色、世界观、剧情）。用于了解项目结构。返回项目内相对路径与类型。',
  parameters: {
    type: 'object',
    properties: {
      directory: {
        type: 'string',
        description: '可选的子目录过滤，例如 "chapters"、"characters"。留空表示整个项目。',
      },
    },
    additionalProperties: false,
  },
  schema: z.object({ directory: z.string().max(200).optional() }),
  mutating: false,
  async execute(args, context): Promise<ToolOutcome> {
    const files = await context.project.listFiles();
    const directory = args.directory ? normalizeRelativePath(args.directory) : null;
    const filtered = directory
      ? files.filter((file) => file.path.startsWith(`${directory}/`) || file.path === directory)
      : files;
    const entries = await Promise.all(
      filtered.map(async (file) => {
        const raw = await context.project.readFileOrNull(file.path);
        const parsed = raw === null ? null : parseMarkdown(raw);
        const title =
          typeof parsed?.frontmatter.title === 'string'
            ? parsed.frontmatter.title
            : typeof parsed?.frontmatter.name === 'string'
              ? parsed.frontmatter.name
              : null;
        return {
          path: file.path,
          title,
          bytes: raw?.length ?? 0,
        };
      }),
    );
    return {
      data: { total: entries.length, files: entries },
      summary: `列出 ${entries.length} 个文件`,
    };
  },
});

export const readProjectFileTool = defineTool({
  name: 'read_project_file',
  description: '读取项目内某个文件的完整内容。路径必须是项目内相对路径，例如 chapters/001.md。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '项目内相对路径，例如 "chapters/001.md"' },
    },
    required: ['path'],
    additionalProperties: false,
  },
  schema: z.object({ path: FilePathArg }),
  mutating: false,
  async execute(args, context): Promise<ToolOutcome> {
    const path = normalizeRelativePath(args.path);
    const content = await context.project.readFileOrNull(path);
    if (content === null) {
      throw new StoryCodeError('NOT_FOUND', `文件不存在：${path}`);
    }
    const citation: Citation = {
      filePath: path,
      title: path.split('/').pop() ?? path,
      excerpt: excerpt(content, 200),
    };
    return {
      data: { path, content },
      citations: [citation],
      summary: `读取 ${path}`,
    };
  },
});

export const searchProjectFilesTool = defineTool({
  name: 'search_project_files',
  description:
    '在项目全文中检索关键词（支持中文）。返回匹配的文件、片段与行号。如果没有任何结果，必须如实说明未找到，不得编造。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索关键词或短句' },
      limit: { type: 'integer', description: '返回结果上限，默认 8', minimum: 1, maximum: 30 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  schema: z.object({
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  mutating: false,
  execute(args, context): ToolOutcome {
    const hits = context.indexer.search(args.query, args.limit ?? 8);
    const citations: Citation[] = hits.map((hit) => ({
      filePath: hit.path,
      title: hit.title,
      excerpt: hit.snippet.slice(0, 300),
      startLine: hit.startLine,
      endLine: hit.endLine,
    }));
    return {
      data: {
        query: args.query,
        resultCount: hits.length,
        results: hits.map((hit) => ({
          path: hit.path,
          title: hit.title,
          kind: hit.kind,
          snippet: hit.snippet,
          startLine: hit.startLine,
          endLine: hit.endLine,
          score: Number(hit.score.toFixed(3)),
        })),
        note: hits.length === 0 ? '未检索到相关内容，请勿编造。' : undefined,
      },
      citations,
      summary:
        hits.length === 0
          ? `检索"${args.query}"：无结果`
          : `检索"${args.query}"：${hits.length} 条`,
    };
  },
});

export const proposeCreateFileTool = defineTool({
  name: 'propose_create_file',
  description:
    '提议新建一个项目文件。不会立即写入磁盘，而是进入待审阅的变更提案，必须经作者确认后才会真正保存。用于创建章节、角色卡、世界观等。',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          '项目内相对路径。章节必须形如 "chapters/001.md"，角色卡形如 "characters/character-001.md"。',
      },
      content: {
        type: 'string',
        description: '完整文件内容（Markdown，含 YAML frontmatter 时请放在开头）',
      },
      summary: { type: 'string', description: '一句话说明这个文件是什么' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  schema: z.object({
    path: FilePathArg,
    content: z.string().max(2_000_000),
    summary: z.string().max(300).optional(),
  }),
  mutating: true,
  async execute(args, context): Promise<ToolOutcome> {
    const path = normalizeRelativePath(args.path);
    if (path.startsWith('world/'))
      throw new StoryCodeError(
        'VALIDATION_FAILED',
        '世界观文件必须经过方向选择与 propose_world_setting；不能用通用文件工具绕过。',
      );
    if (path.startsWith('characters/'))
      throw new StoryCodeError(
        'VALIDATION_FAILED',
        '创建角色卡请使用 propose_character_cards，以校验结构和设定来源。',
      );
    if (!path.endsWith('.md')) {
      throw new StoryCodeError('VALIDATION_FAILED', '新建文件必须是 .md 文件');
    }
    if (await context.project.exists(path)) {
      throw new StoryCodeError('ALREADY_EXISTS', `文件已存在，请改用 propose_edit_file：${path}`);
    }
    if (context.pending.some((change) => change.filePath === path)) {
      throw new StoryCodeError('VALIDATION_FAILED', `本次任务已经提议过该文件：${path}`);
    }
    context.pending.push({
      operation: 'create',
      filePath: path,
      nextContent: args.content,
      kind: kindFromPath(path),
      summary: args.summary ?? `新建 ${path}`,
    });
    return {
      data: {
        queued: true,
        path,
        note: '已加入待审阅提案，作者确认后才会写入文件。不要声称已经创建。',
      },
      summary: `提议新建 ${path}`,
    };
  },
});

export const proposeEditFileTool = defineTool({
  name: 'propose_edit_file',
  description:
    '提议修改一个已存在的项目文件（必须提供完整的新内容）。不会立即写入磁盘，进入待审阅提案，经作者确认后才会保存。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要修改的项目内相对路径' },
      content: { type: 'string', description: '修改后的完整文件内容（不是差异片段）' },
      summary: { type: 'string', description: '一句话说明改了什么' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  schema: z.object({
    path: FilePathArg,
    content: z.string().max(2_000_000),
    summary: z.string().max(300).optional(),
  }),
  mutating: true,
  async execute(args, context): Promise<ToolOutcome> {
    const path = normalizeRelativePath(args.path);
    if (path.startsWith('world/'))
      throw new StoryCodeError(
        'VALIDATION_FAILED',
        '世界观文件必须经过方向选择与 propose_world_setting；不能用通用文件工具绕过。',
      );
    if (path.startsWith('characters/'))
      throw new StoryCodeError(
        'VALIDATION_FAILED',
        '修改角色卡请使用 propose_character_update，以保护已确认设定和变更历史。',
      );
    const exists = await context.project.exists(path);
    if (!exists) {
      throw new StoryCodeError('NOT_FOUND', `文件不存在，请改用 propose_create_file：${path}`);
    }
    const previous = await context.project.readFile(path);
    if (previous === args.content) {
      throw new StoryCodeError('VALIDATION_FAILED', '新内容与原文件完全一致，没有实际修改');
    }
    const alreadyQueued = context.pending.findIndex((change) => change.filePath === path);
    const change: PendingFileChange = {
      operation: 'update',
      filePath: path,
      nextContent: args.content,
      kind: kindFromPath(path),
      summary: args.summary ?? `修改 ${path}`,
    };
    if (alreadyQueued >= 0) {
      context.pending[alreadyQueued] = change;
    } else {
      context.pending.push(change);
    }
    return {
      data: {
        queued: true,
        path,
        note: '已加入待审阅提案，作者确认后才会写入。不要声称已经修改。',
      },
      summary: `提议修改 ${path}`,
    };
  },
});

export const proposeDeleteFileTool = defineTool({
  name: 'propose_delete_file',
  description:
    '提议删除一个项目文件。删除属于高风险操作，会强制要求作者逐项确认。除非作者明确要求，否则不要使用。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要删除的项目内相对路径' },
      reason: { type: 'string', description: '删除原因' },
    },
    required: ['path', 'reason'],
    additionalProperties: false,
  },
  schema: z.object({ path: FilePathArg, reason: z.string().min(1).max(500) }),
  mutating: true,
  async execute(args, context): Promise<ToolOutcome> {
    const path = normalizeRelativePath(args.path);
    if (!(await context.project.exists(path))) {
      throw new StoryCodeError('NOT_FOUND', `文件不存在：${path}`);
    }
    if (context.pending.some((change) => change.filePath === path)) {
      throw new StoryCodeError('VALIDATION_FAILED', `本次任务已经提议过该文件：${path}`);
    }
    context.pending.push({
      operation: 'delete',
      filePath: path,
      nextContent: '',
      kind: kindFromPath(path),
      summary: args.reason,
    });
    return {
      data: { queued: true, path, requiresConfirmation: true },
      summary: `提议删除 ${path}`,
    };
  },
});

export const FILE_TOOLS: readonly ToolDefinition[] = [
  listProjectFilesTool,
  readProjectFileTool,
  searchProjectFilesTool,
  proposeCreateFileTool,
  proposeEditFileTool,
  proposeDeleteFileTool,
];
