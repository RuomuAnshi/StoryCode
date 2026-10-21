/** Structured character proposals; no model output can write a novel file here. */
import {
  CharacterCardSchema,
  CharacterFactSchema,
  CharacterFieldSchema,
  StoryCodeError,
  contentHash,
  createId,
  normalizeRelativePath,
  parseMarkdown,
  serializeMarkdown,
  renderCharacterBody,
  isAuthoritativeFact,
  type CharacterCard,
  type CharacterDesign,
  type CharacterFact,
  type CharacterField,
  type CharacterUpdate,
} from '@storycode/core';
import { z } from 'zod';
import type { PendingFileChange, ToolContext } from '../tools/types.js';

const START = '<!-- storycode:character:start -->';
const END = '<!-- storycode:character:end -->';
function invalid(message: string): never {
  throw new StoryCodeError('VALIDATION_FAILED', message);
}
function fieldValue(card: CharacterCard, field: CharacterField): unknown {
  let value: unknown = card;
  for (const part of field.split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
function textValue(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}
function verifyQuote(quote: string, value: unknown, input: string, field: CharacterField): void {
  const values: unknown[] = Array.isArray(value) ? value : [value];
  const roleLabels: Record<string, string[]> = {
    protagonist: ['主角'],
    supporting: ['配角'],
    antagonist: ['反派'],
    other: ['其他角色'],
  };
  const matches = (v: unknown) =>
    field === 'role' && typeof v === 'string'
      ? quote.includes(v) || (roleLabels[v] ?? []).some((label) => quote.includes(label))
      : typeof v === 'number'
        ? (quote.match(/\d+/g)?.some((digits) => digits === String(v)) ?? false)
        : quote.includes(String(v));
  if (!input.includes(quote) || values.length === 0 || values.some((v) => !matches(v))) {
    invalid(
      `字段 ${field} 的 quote 必须来自本轮作者输入，并包含该字段的全部值（role 支持主角/配角/反派等明确中文定位）。若数组混入了推导内容，请移除该字段的 sources，让整个字段保持 AI 建议，不要删掉作者信息。`,
    );
  }
}
function makeFact(card: CharacterCard, field: CharacterField, quote?: string): CharacterFact {
  const now = new Date().toISOString();
  return CharacterFactSchema.parse({
    id: createId('fact'),
    subjectId: card.id,
    predicate: field,
    value: textValue(fieldValue(card, field)),
    status: quote ? 'user_confirmed' : 'ai_proposed',
    sourceRefs: [],
    createdAt: now,
    updatedAt: now,
    ...(quote ? { userQuote: quote } : {}),
  });
}
function managedBody(card: CharacterCard, facts: CharacterFact[]): string {
  const escape = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const rows = facts
    .filter((f) => f.status !== 'superseded')
    .map(
      (f) =>
        `| ${escape(f.predicate)} | ${escape(f.value)} | ${f.status === 'user_confirmed' ? '作者明确提供' : f.status === 'source_confirmed' ? '正文已确立' : f.status === 'rejected' ? '已否决' : 'AI 建议（未确认）'} | ${escape(f.userQuote ?? '—')} |`,
    );
  return `${START}\n${renderCharacterBody(card)}\n## 设定来源\n\n接受文件提案不等于确认 AI 补充设定；未确认内容不能当作既定事实。\n\n| 字段 | 值 | 来源状态 | 作者原话 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n${END}`;
}
function serialize(
  card: CharacterCard,
  facts: CharacterFact[],
  body?: string,
  original: Record<string, unknown> = {},
): string {
  return serializeMarkdown(
    { ...original, ...card, type: 'character', factIds: facts.map((f) => f.id), facts },
    body ?? `${managedBody(card, facts)}\n`,
  );
}
function safeCharacterPath(id: string): string {
  if (!/^character-[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(id))
    invalid('角色 ID 必须为 character- 后接字母、数字或连字符。');
  return `characters/${id}.md`;
}
function assertNotQueued(path: string, context: ToolContext): void {
  if (context.pending.some((c) => c.filePath === path))
    invalid(`本轮已经提议该文件，请先审核再继续修改：${path}`);
}

export async function designCharacters(
  design: CharacterDesign,
  context: ToolContext,
): Promise<PendingFileChange[]> {
  const staged: PendingFileChange[] = [];
  const ids = new Map<string, string>();
  const names = new Set<string>();
  const files = await context.project.listFiles();
  for (const file of files.filter((f) => f.path.startsWith('characters/'))) {
    const parsed = parseMarkdown(await context.project.readFile(file.path));
    if (typeof parsed.frontmatter.id === 'string') ids.set(parsed.frontmatter.id, file.path);
    if (typeof parsed.frontmatter.name === 'string') names.add(parsed.frontmatter.name);
  }
  for (const { card: rawCard, sources } of design.characters) {
    const card = CharacterCardSchema.parse({ ...rawCard, status: 'draft', factIds: [] });
    const path = safeCharacterPath(card.id);
    if (ids.has(card.id) || names.has(card.name) || (await context.project.exists(path)))
      invalid(`角色 ID、姓名或文件已存在：${card.name}。请使用更新工具。`);
    if (card.relationships.length)
      invalid('人物关系请通过 relationships 提供，不要在角色卡中自行填入未验证的关系 ID。');
    assertNotQueued(path, context);
    const sourceMap = new Map<CharacterField, string>();
    for (const source of sources) {
      if (sourceMap.has(source.field)) invalid(`重复的来源字段：${source.field}`);
      verifyQuote(
        source.quote,
        fieldValue(card, source.field),
        context.userInput ?? '',
        source.field,
      );
      sourceMap.set(source.field, source.quote);
    }
    const facts = CharacterFieldSchema.options.flatMap((field) => {
      const value = fieldValue(card, field);
      if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) return [];
      return [makeFact(card, field, sourceMap.get(field))];
    });
    staged.push({
      operation: 'create',
      filePath: path,
      nextContent: serialize(card, facts),
      kind: 'character',
      summary: `新建角色卡：${card.name}（含逐字段来源）`,
      baseContentHash: null,
    });
    ids.set(card.id, path);
    names.add(card.name);
  }
  const relationIds = new Set<string>();
  for (const relation of design.relationships) {
    if (
      !/^relationship-[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(relation.id) ||
      relationIds.has(relation.id)
    )
      invalid('关系 ID 非法或重复。');
    if (
      !ids.has(relation.sourceCharacterId) ||
      !ids.has(relation.targetCharacterId) ||
      relation.sourceCharacterId === relation.targetCharacterId
    )
      invalid('关系必须引用两个存在且不同的角色 ID。');
    const path = `plot/relationships/${relation.id}.md`;
    assertNotQueued(path, context);
    if (await context.project.exists(path)) invalid(`关系文件已存在：${path}`);
    relationIds.add(relation.id);
    staged.push({
      operation: 'create',
      filePath: path,
      kind: 'plot',
      summary: '人物关系建议（未确认）',
      baseContentHash: null,
      dependsOnPaths: [ids.get(relation.sourceCharacterId)!, ids.get(relation.targetCharacterId)!],
      nextContent: serializeMarkdown(
        { ...relation, status: 'draft', factStatus: 'ai_proposed', entityType: 'relationship' },
        `# 人物关系建议\n\n${relation.sourceCharacterId} → ${relation.targetCharacterId}\n\n${relation.description}\n\n- 发起方视角：${relation.sourcePerspective ?? '未确定'}\n- 对方视角：${relation.targetPerspective ?? '未确定'}\n\nAI 建议（未确认），不得当作既定关系。\n`,
      ),
    });
  }
  return staged;
}

export async function updateCharacter(
  update: CharacterUpdate,
  context: ToolContext,
): Promise<PendingFileChange> {
  const path = normalizeRelativePath(update.path);
  if (!path.startsWith('characters/') || !path.endsWith('.md'))
    invalid('只能更新 characters/ 中的 Markdown 角色卡。');
  assertNotQueued(path, context);
  const raw = await context.project.readFile(path);
  const parsed = parseMarkdown(raw);
  const card = CharacterCardSchema.parse(parsed.frontmatter);
  const facts = z.array(CharacterFactSchema).parse(parsed.frontmatter.facts);
  const originalBlock = managedBody(card, facts);
  if (
    !parsed.body.includes(originalBlock) ||
    parsed.body.split(START).length !== 2 ||
    parsed.body.split(END).length !== 2
  ) {
    invalid(
      '角色卡正文或来源表已被手动修改，暂不能安全局部更新。请先核对 Markdown 结构；不会覆盖作者内容。',
    );
  }
  let nextCard = card;
  const seen = new Set<string>();
  for (const change of update.changes) {
    if (seen.has(change.field)) invalid(`重复更新字段：${change.field}`);
    seen.add(change.field);
    const current = fieldValue(card, change.field);
    if (textValue(current) === textValue(change.value)) continue;
    const previousFacts = facts.filter(
      (f) => f.predicate === change.field && f.status !== 'superseded',
    );
    if (change.quote)
      verifyQuote(change.quote, change.value, context.userInput ?? '', change.field);
    if (
      (card.status === 'confirmed' ||
        previousFacts.some((f) => isAuthoritativeFact(f.status) || f.status === 'rejected')) &&
      !change.quote
    ) {
      invalid(`修改已确认或已否决字段 ${change.field} 必须提供本轮作者明确指定新值的原话。`);
    }
    const updated: Record<string, unknown> = structuredClone(nextCard);
    const [top, leaf] = change.field.split('.');
    if (!top) invalid('缺少字段名');
    if (leaf) updated[top] = { ...(updated[top] as Record<string, unknown>), [leaf]: change.value };
    else updated[top] = change.value;
    nextCard = CharacterCardSchema.parse(updated);
    const fact = makeFact(nextCard, change.field, change.quote);
    fact.supersedes = previousFacts.map((f) => f.id);
    for (const previous of previousFacts) {
      previous.status = 'superseded';
      previous.updatedAt = fact.createdAt;
    }
    facts.push(fact);
  }
  if (nextCard === card) invalid('没有实际字段变化。');
  return {
    operation: 'update',
    filePath: path,
    kind: 'character',
    summary: `更新角色 ${card.name}：${[...seen].join('、')}`,
    baseContentHash: contentHash(raw),
    nextContent: serialize(
      nextCard,
      facts,
      parsed.body.replace(originalBlock, managedBody(nextCard, facts)),
      parsed.frontmatter,
    ),
  };
}
