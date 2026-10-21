import { z } from 'zod';
import { DIRS, excerpt, parseMarkdown, type Citation } from '@storycode/core';
import { defineTool, type ToolDefinition, type ToolOutcome } from './types.js';

const MAX_CHAPTER_CHARS = 12000;

export const getChapterTool = defineTool({
  name: 'get_chapter',
  description: '按章节序号读取正文。用于续写或修改前了解前文。',
  parameters: {
    type: 'object',
    properties: {
      order: { type: 'integer', description: '章节序号（从 1 开始）', minimum: 1 },
    },
    required: ['order'],
    additionalProperties: false,
  },
  schema: z.object({ order: z.number().int().min(1).max(100000) }),
  mutating: false,
  async execute(args, context): Promise<ToolOutcome> {
    const path = `${DIRS.chapters}/${String(args.order).padStart(3, '0')}.md`;
    const raw = await context.project.readFileOrNull(path);
    if (raw === null) {
      return { data: { found: false, order: args.order }, summary: `第 ${args.order} 章不存在` };
    }
    const parsed = parseMarkdown(raw);
    const truncated = parsed.body.length > MAX_CHAPTER_CHARS;
    const body = truncated ? parsed.body.slice(0, MAX_CHAPTER_CHARS) : parsed.body;
    const citation: Citation = {
      filePath: path,
      title:
        typeof parsed.frontmatter.title === 'string'
          ? parsed.frontmatter.title
          : `第 ${args.order} 章`,
      excerpt: excerpt(parsed.body, 200),
    };
    return {
      data: {
        found: true,
        order: args.order,
        path,
        title: citation.title,
        body,
        truncated,
        fullLength: parsed.body.length,
      },
      citations: [citation],
      summary: `读取第 ${args.order} 章`,
    };
  },
});

export const listChaptersTool = defineTool({
  name: 'list_chapters',
  description: '列出所有章节的序号、标题、状态与字数，用于掌握全书进度。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  schema: z.object({}),
  mutating: false,
  async execute(_args, context): Promise<ToolOutcome> {
    const chapters = await context.project.listChapters();
    const detailed = await Promise.all(
      chapters.map(async (chapter) => {
        const path = `${DIRS.chapters}/${String(chapter.order).padStart(3, '0')}.md`;
        const raw = await context.project.readFileOrNull(path);
        return {
          order: chapter.order,
          title: chapter.title,
          status: chapter.status,
          path,
          characters: chapter.characterIds,
          chars: raw === null ? 0 : parseMarkdown(raw).body.length,
        };
      }),
    );
    return {
      data: { count: detailed.length, chapters: detailed },
      summary: `共 ${detailed.length} 章`,
    };
  },
});

export const getRecentChaptersTool = defineTool({
  name: 'get_recent_chapters',
  description: '获取当前章节之前最近的若干章内容摘要，用于续写时保持连贯。',
  parameters: {
    type: 'object',
    properties: {
      beforeOrder: { type: 'integer', description: '当前章节序号；留空则取文件末尾', minimum: 1 },
      count: { type: 'integer', description: '获取章数，默认 2，最多 5', minimum: 1, maximum: 5 },
    },
    additionalProperties: false,
  },
  schema: z.object({
    beforeOrder: z.number().int().min(1).optional(),
    count: z.number().int().min(1).max(5).optional(),
  }),
  mutating: false,
  async execute(args, context): Promise<ToolOutcome> {
    const chapters = await context.project.listChapters();
    const currentOrder =
      args.beforeOrder ?? context.activeChapterOrder ?? (chapters.at(-1)?.order ?? 0) + 1;
    const recent = await context.indexer.recentChapters(currentOrder, args.count ?? 2);
    const citations: Citation[] = recent.map((chapter) => ({
      filePath: chapter.path,
      title: chapter.title,
      excerpt: chapter.excerpt.slice(0, 200),
    }));
    return {
      data: { currentOrder, chapters: recent },
      citations,
      summary: `读取前 ${recent.length} 章`,
    };
  },
});

export const getCharacterTool = defineTool({
  name: 'get_character',
  description: '按角色名或角色 ID 读取角色卡。用于确保续写符合人物设定。',
  parameters: {
    type: 'object',
    properties: {
      nameOrId: { type: 'string', description: '角色姓名或角色 ID' },
    },
    required: ['nameOrId'],
    additionalProperties: false,
  },
  schema: z.object({ nameOrId: z.string().min(1).max(100) }),
  mutating: false,
  async execute(args, context): Promise<ToolOutcome> {
    const files = await context.project.listFiles();
    const needle = args.nameOrId.toLowerCase();
    const matches: Array<{ path: string; content: string; name: string }> = [];
    for (const file of files) {
      if (!file.path.startsWith(`${DIRS.characters}/`)) continue;
      const raw = await context.project.readFileOrNull(file.path);
      if (raw === null) continue;
      const parsed = parseMarkdown(raw);
      const name = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name : '';
      const id = typeof parsed.frontmatter.id === 'string' ? parsed.frontmatter.id : '';
      if (
        name.toLowerCase().includes(needle) ||
        id.toLowerCase() === needle ||
        file.path.toLowerCase().includes(needle)
      ) {
        matches.push({ path: file.path, content: raw, name: name || file.path });
      }
    }
    if (matches.length === 0) {
      return {
        data: { found: false, query: args.nameOrId },
        summary: `未找到角色：${args.nameOrId}`,
      };
    }
    const citations: Citation[] = matches.map((match) => ({
      filePath: match.path,
      title: match.name,
      excerpt: excerpt(match.content, 200),
    }));
    return {
      data: {
        found: true,
        characters: matches,
        note: '请逐项读取 facts 来源：ai_proposed/inferred 仅为建议，rejected 已否决，superseded 已被替代。卡片接受或保存不代表 AI 补充已被确认。',
      },
      citations,
      summary: `读取角色：${matches.map((match) => match.name).join('、')}`,
    };
  },
});

export const listCharactersTool = defineTool({
  name: 'list_characters',
  description: '列出项目中已有角色的姓名、定位和一句话简介。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  schema: z.object({}),
  mutating: false,
  async execute(_args, context): Promise<ToolOutcome> {
    const files = await context.project.listFiles();
    const characters: Array<{ name: string; role: string; path: string; bio: string }> = [];
    for (const file of files) {
      if (!file.path.startsWith(`${DIRS.characters}/`)) continue;
      const raw = await context.project.readFileOrNull(file.path);
      if (raw === null) continue;
      const parsed = parseMarkdown(raw);
      const name =
        typeof parsed.frontmatter.name === 'string'
          ? parsed.frontmatter.name
          : (file.path.split('/').pop() ?? file.path);
      const role = typeof parsed.frontmatter.role === 'string' ? parsed.frontmatter.role : 'other';
      const background = parsed.frontmatter.background;
      const bio =
        background &&
        typeof background === 'object' &&
        'biography' in background &&
        typeof (background as { biography?: unknown }).biography === 'string'
          ? ((background as { biography: string }).biography ?? '').slice(0, 100)
          : excerpt(parsed.body, 100);
      characters.push({ name, role, path: file.path, bio });
    }
    return {
      data: { count: characters.length, characters },
      summary: `共 ${characters.length} 个角色`,
    };
  },
});

export const getWorldSettingTool = defineTool({
  name: 'get_world_setting',
  description: '读取世界观设定文件（概述、规则、历史、组织）。用于确保新内容与既定设定一致。',
  parameters: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        enum: ['overview', 'rules', 'history', 'organizations', 'all'],
        description: '要读取的部分，默认 all',
      },
    },
    additionalProperties: false,
  },
  schema: z.object({
    section: z.enum(['overview', 'rules', 'history', 'organizations', 'all']).optional(),
  }),
  mutating: false,
  async execute(args, context): Promise<ToolOutcome> {
    const section = args.section ?? 'all';
    const targets =
      section === 'all'
        ? ['overview', 'rules', 'history', 'organizations'].map(
            (name) => `${DIRS.world}/${name}.md`,
          )
        : [`${DIRS.world}/${section}.md`];
    const found: Array<{ path: string; content: string }> = [];
    for (const path of targets) {
      const raw = await context.project.readFileOrNull(path);
      if (raw !== null) found.push({ path, content: raw });
    }
    const citations: Citation[] = found.map((file) => ({
      filePath: file.path,
      title: file.path.split('/').pop() ?? file.path,
      excerpt: excerpt(file.content, 200),
    }));
    return {
      data: {
        found: found.length > 0,
        files: found,
        note: '请核对 status 与 factStatus。作者选定方向不代表新增的组织、规则、历史等细节已确认；ai_proposed 仅供建议。',
      },
      citations,
      summary: found.length === 0 ? '暂无世界观文件' : `读取世界观（${found.length} 个文件）`,
    };
  },
});

export const getStoryRulesTool = defineTool({
  name: 'get_story_rules',
  description: '读取 STORY.md 中的项目固定规则（文风、禁忌、创作方向）。写作前必须遵守。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  schema: z.object({}),
  mutating: false,
  async execute(_args, context): Promise<ToolOutcome> {
    const raw = await context.project.readFileOrNull('STORY.md');
    if (raw === null) {
      return { data: { found: false }, summary: 'STORY.md 不存在' };
    }
    return {
      data: { found: true, content: raw },
      citations: [{ filePath: 'STORY.md', title: '小说总纲', excerpt: excerpt(raw, 200) }],
      summary: '读取项目规则',
    };
  },
});

export const getEditorSelectionTool = defineTool({
  name: 'get_editor_selection',
  description: '获取作者在编辑器中选中的原文，用于定向改写。没有选中内容时返回空。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  schema: z.object({}),
  mutating: false,
  execute(_args, context): ToolOutcome {
    if (!context.selection) {
      return { data: { hasSelection: false }, summary: '当前没有选中文本' };
    }
    return {
      data: {
        hasSelection: true,
        activeFilePath: context.activeFilePath ?? null,
        startLine: context.selection.startLine,
        endLine: context.selection.endLine,
        text: context.selection.text,
      },
      summary: `读取选中文本（${context.selection.text.length} 字）`,
    };
  },
});

export const STORY_TOOLS: readonly ToolDefinition[] = [
  getChapterTool,
  listChaptersTool,
  getRecentChaptersTool,
  getCharacterTool,
  listCharactersTool,
  getWorldSettingTool,
  getStoryRulesTool,
  getEditorSelectionTool,
];
