/**
 * Context Engine: assembles the prompt for a task within a token budget.
 *
 * The spec forbids dumping the whole novel into every request, so context is
 * layered and budgeted, and anything dropped is recorded for transparency.
 */

import { DIRS, parseMarkdown, characterRetrievalText } from '@storycode/core';
import type { ProjectIndexer, ProjectStore } from '@storycode/storage';
import type { PromptContext } from '../prompts/system.js';

export interface ContextBudget {
  /** Rough token ceiling for the assembled context block. */
  maxTokens: number;
}

export const DEFAULT_BUDGET: ContextBudget = { maxTokens: 24000 };

export interface AssembledContext {
  prompt: PromptContext;
  /** What was included, for the "引用文件" UI panel. */
  included: Array<{ path: string; reason: string; chars: number }>;
  /** What was dropped because of the budget. */
  dropped: Array<{ path: string; reason: string }>;
  estimatedTokens: number;
}

/** Rough token estimate: CJK ~1 token/char, latin ~0.25 token/char. */
export function estimateTokens(text: string): number {
  let cjk = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x2e80) cjk += 1;
  }
  const latin = Math.max(0, text.length - cjk);
  return Math.ceil(cjk + latin * 0.25);
}

export interface BuildContextOptions {
  projectName: string;
  mode: 'ask' | 'plan' | 'agent';
  indexer: ProjectIndexer;
  project: ProjectStore;
  activeFilePath?: string;
  activeChapterOrder?: number;
  selection?: { text: string; startLine: number; endLine: number };
  /** Terms to retrieve related context for, usually derived from the user message. */
  query?: string;
  budget?: ContextBudget;
}

export async function assembleContext(options: BuildContextOptions): Promise<AssembledContext> {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const included: AssembledContext['included'] = [];
  const dropped: AssembledContext['dropped'] = [];
  let used = 0;

  const tryAdd = (path: string, reason: string, text: string): boolean => {
    const cost = estimateTokens(text);
    if (used + cost > budget.maxTokens) {
      dropped.push({
        path,
        reason: `超出上下文预算（需要 ${cost}，剩余 ${Math.max(0, budget.maxTokens - used)}）`,
      });
      return false;
    }
    used += cost;
    included.push({ path, reason, chars: text.length });
    return true;
  };

  // L0: project rules are always included — they are hard constraints.
  const storyRules = await options.project.readFileOrNull('STORY.md');
  if (storyRules) {
    tryAdd('STORY.md', '项目固定规则（文风/禁忌/方向）', storyRules);
  }

  // L1: the file the author is looking at.
  let activeChapterTitle: string | undefined;
  if (options.activeFilePath) {
    const active = await options.project.readFileOrNull(options.activeFilePath);
    if (active) {
      const parsed = parseMarkdown(active);
      if (typeof parsed.frontmatter.title === 'string')
        activeChapterTitle = parsed.frontmatter.title;
      // Only the head of the active file: the selection and instructions matter more.
      tryAdd(options.activeFilePath, '当前打开的文件', truncate(active, 6000));
    }
  }

  // L2: neighbouring chapters.
  const recent: Array<{ title: string; excerpt: string }> = [];
  const chapterOrder = options.activeChapterOrder;
  if (chapterOrder !== undefined) {
    const neighbours = await options.indexer.recentChapters(chapterOrder, 2);
    for (const chapter of neighbours) {
      const block = `${chapter.title}\n${chapter.excerpt}`;
      if (tryAdd(chapter.path, '邻近章节', block)) {
        recent.push({ title: chapter.title, excerpt: truncate(chapter.excerpt, 500) });
      }
    }
  }

  // L3: retrieval driven by the user's request.
  const retrieved: Array<{ path: string; title: string; excerpt: string }> = [];
  let characterSummary: string | undefined;
  let worldSummary: string | undefined;
  let outlineSummary: string | undefined;

  if (options.query && options.query.trim().length > 0) {
    const hits = options.indexer.search(options.query, 6);
    for (const hit of hits) {
      if (hit.path === options.activeFilePath) continue;
      if (included.some((entry) => entry.path === hit.path)) continue;
      const block = `${hit.title}\n${hit.snippet}`;
      // Recording a hit in `included` is not enough: the text must reach the
      // prompt, otherwise the model sees no evidence and will invent one.
      if (tryAdd(hit.path, `检索命中：${hit.matchedTerms.slice(0, 4).join('、')}`, block)) {
        retrieved.push({ path: hit.path, title: hit.title, excerpt: hit.snippet });
      }
    }
  }

  // L3 (structured): a compact roster of characters and world titles, cheap and high value.
  const files = await options.project.listFiles();
  const characterLines: string[] = [];
  for (const file of files) {
    if (!file.path.startsWith(`${DIRS.characters}/`)) continue;
    const raw = await options.project.readFileOrNull(file.path);
    if (!raw) continue;
    const parsed = parseMarkdown(raw);
    const name = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name : file.path;
    const role = typeof parsed.frontmatter.role === 'string' ? parsed.frontmatter.role : 'other';
    characterLines.push(
      `- ${name}（${role}；${parsed.frontmatter.status === 'confirmed' ? '卡片已确认，仍须逐项核对 facts 状态' : '草稿，AI 补充尚未确认'}）：${characterRetrievalText(raw)}。使用任何具体设定前先 get_character 核对字段来源。`,
    );
  }
  if (characterLines.length > 0) {
    characterSummary = characterLines.join('\n');
    tryAdd('characters/*', `角色名册（${characterLines.length} 人）`, characterSummary);
  }

  const worldOverview = await options.project.readFileOrNull(`${DIRS.world}/overview.md`);
  if (worldOverview) {
    const worldMeta = parseMarkdown(worldOverview).frontmatter;
    worldSummary = truncate(
      `${worldMeta.factStatus === 'ai_proposed' ? '世界观草稿：作者已选择创作方向，但新增组织、规则、历史等细节仍为 AI 建议，不能当作确定事实。\n' : ''}${worldOverview}`,
      1500,
    );
    tryAdd(`${DIRS.world}/overview.md`, '世界观概述', worldSummary);
  }

  const outline = await options.project.readFileOrNull(`${DIRS.plot}/outline.md`);
  if (outline) {
    outlineSummary = truncate(outline, 2000);
    tryAdd(`${DIRS.plot}/outline.md`, '剧情大纲', outlineSummary);
  }

  const prompt: PromptContext = {
    projectName: options.projectName,
    mode: options.mode,
    storyRules: storyRules ? truncate(storyRules, 3000) : null,
    ...(options.activeFilePath ? { activeFilePath: options.activeFilePath } : {}),
    ...(activeChapterTitle ? { activeChapterTitle } : {}),
    ...(options.selection ? { selection: options.selection } : {}),
    ...(recent.length > 0 ? { recentChapters: recent } : {}),
    ...(retrieved.length > 0 ? { retrieved } : {}),
    ...(characterSummary ? { characterSummary } : {}),
    ...(worldSummary ? { worldSummary } : {}),
    ...(outlineSummary ? { outlineSummary } : {}),
  };

  return { prompt, included, dropped, estimatedTokens: used };
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}\n…（已截断）`;
}
