/**
 * Typed accessors that map Markdown files <-> domain entities.
 *
 * Each document type knows how to parse its frontmatter and how to render the
 * body, so the explorer, the agent tools and the validators all agree on the
 * shape of a chapter or character file.
 */

import { extractFirstHeading, parseMarkdown, serializeMarkdown } from './markdown.js';
import { createId } from './ids.js';
import {
  ChapterMetaSchema,
  type ChapterMeta,
  type ProjectMeta,
  ProjectMetaSchema,
} from './schemas/project.js';
import { CharacterCardSchema, type CharacterCard } from './schemas/character.js';
import { WorldSettingSchema, type WorldSetting } from './schemas/world.js';
import { CharacterRelationshipSchema, type CharacterRelationship } from './schemas/relationship.js';
import { StoryEventSchema, type StoryEvent } from './schemas/event.js';
import { ValidationError } from './errors.js';

export interface ChapterDocument {
  path: string;
  meta: ChapterMeta;
  body: string;
}

export interface CharacterDocument {
  path: string;
  card: CharacterCard;
  body: string;
}

export interface WorldDocument {
  path: string;
  setting: WorldSetting;
  body: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatZodIssues(error: unknown): string[] {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      return issues.map((issue) => {
        const rec = asRecord(issue);
        const path = Array.isArray(rec.path) ? rec.path.join('.') : '';
        const message = rec.message;
        return `${path || '(root)'}: ${typeof message === 'string' ? message : 'invalid'}`;
      });
    }
  }
  return [error instanceof Error ? error.message : String(error)];
}

/** Parses a chapter file; frontmatter is optional and repaired from content. */
export function parseChapterDocument(
  path: string,
  source: string,
  fallbackOrder: number,
): ChapterDocument {
  const parsed = parseMarkdown(source);
  const fm = parsed.frontmatter;
  const heading = extractFirstHeading(parsed.body);
  const raw = {
    id: typeof fm.id === 'string' && fm.id.length > 0 ? fm.id : createId('chapter'),
    title:
      typeof fm.title === 'string' && fm.title.trim().length > 0
        ? fm.title
        : (heading ?? `第 ${fallbackOrder} 章`),
    order: typeof fm.order === 'number' && fm.order >= 1 ? fm.order : fallbackOrder,
    status: fm.status ?? 'draft',
    volumeId: fm.volumeId,
    characterIds: Array.isArray(fm.characterIds) ? fm.characterIds : [],
    createdAt: typeof fm.createdAt === 'string' ? fm.createdAt : new Date(0).toISOString(),
    updatedAt: typeof fm.updatedAt === 'string' ? fm.updatedAt : new Date(0).toISOString(),
  };
  const result = ChapterMetaSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(`Invalid chapter metadata in ${path}`, formatZodIssues(result.error));
  }
  return { path, meta: result.data, body: parsed.body };
}

export function serializeChapterDocument(
  meta: ChapterMeta,
  body: string,
  options: { includeFrontmatter?: boolean } = {},
): string {
  if (options.includeFrontmatter === false) return body;
  const frontmatter: Record<string, unknown> = {
    id: meta.id,
    type: 'chapter',
    title: meta.title,
    order: meta.order,
    status: meta.status,
  };
  if (meta.volumeId) frontmatter.volumeId = meta.volumeId;
  if (meta.characterIds.length > 0) frontmatter.characterIds = meta.characterIds;
  frontmatter.createdAt = meta.createdAt;
  frontmatter.updatedAt = meta.updatedAt;
  return serializeMarkdown(frontmatter, body);
}

export function parseCharacterDocument(path: string, source: string): CharacterDocument {
  const parsed = parseMarkdown(source);
  const fm = parsed.frontmatter;
  const heading = extractFirstHeading(parsed.body);
  const raw = {
    id: typeof fm.id === 'string' && fm.id.length > 0 ? fm.id : createId('character'),
    name:
      typeof fm.name === 'string' && fm.name.trim().length > 0
        ? fm.name
        : (heading ?? '未命名角色'),
    aliases: fm.aliases ?? [],
    role: fm.role ?? 'other',
    basics: fm.basics ?? {},
    personality: fm.personality ?? {},
    background: fm.background ?? {},
    narrative: fm.narrative ?? {},
    relationships: fm.relationships ?? [],
    secrets: fm.secrets ?? [],
    voice: fm.voice ?? {},
    knowledgeState: fm.knowledgeState ?? [],
    status: fm.status ?? 'draft',
    factIds: fm.factIds ?? [],
  };
  const result = CharacterCardSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(`Invalid character card in ${path}`, formatZodIssues(result.error));
  }
  return { path, card: result.data, body: parsed.body };
}

export function serializeCharacterDocument(card: CharacterCard, body: string): string {
  const frontmatter: Record<string, unknown> = {
    id: card.id,
    type: 'character',
    name: card.name,
    status: card.status,
    role: card.role,
  };
  if (card.aliases.length > 0) frontmatter.aliases = card.aliases;
  if (Object.keys(card.basics).length > 0) frontmatter.basics = card.basics;
  frontmatter.personality = card.personality;
  frontmatter.background = card.background;
  frontmatter.narrative = card.narrative;
  if (card.relationships.length > 0) frontmatter.relationships = card.relationships;
  if (card.secrets.length > 0) frontmatter.secrets = card.secrets;
  frontmatter.voice = card.voice;
  if (card.knowledgeState.length > 0) frontmatter.knowledgeState = card.knowledgeState;
  if (card.factIds.length > 0) frontmatter.factIds = card.factIds;
  return serializeMarkdown(frontmatter, body);
}

/** Renders a human-readable Markdown body from a character card. */
export function renderCharacterBody(card: CharacterCard): string {
  const lines: string[] = [`# ${card.name}`, ''];
  if (card.background.biography.trim().length > 0) {
    lines.push('## 人物背景', '', card.background.biography.trim(), '');
  }
  const bullets = (title: string, items: readonly string[]): void => {
    const filtered = items.map((item) => item.trim()).filter((item) => item.length > 0);
    if (filtered.length === 0) return;
    lines.push(`## ${title}`, '', ...filtered.map((item) => `- ${item}`), '');
  };
  bullets('性格特点', card.personality.traits);
  bullets('优点', card.personality.strengths);
  bullets('缺陷', card.personality.flaws);
  bullets('恐惧', card.personality.fears);
  bullets('渴望', card.personality.desires);
  bullets('内在矛盾', card.personality.contradictions);
  bullets('成长经历', card.background.formativeEvents);
  bullets('目标', card.narrative.goals);
  bullets('动机', card.narrative.motivations);
  if (card.narrative.internalConflict) {
    lines.push('## 内在冲突', '', card.narrative.internalConflict, '');
  }
  if (card.narrative.externalConflict) {
    lines.push('## 外部冲突', '', card.narrative.externalConflict, '');
  }
  if (card.narrative.characterArc) {
    lines.push('## 人物弧线', '', card.narrative.characterArc, '');
  }
  if (card.narrative.storyFunction) {
    lines.push('## 剧情功能', '', card.narrative.storyFunction, '');
  }
  bullets('秘密', card.secrets);
  bullets('知道的事', card.knowledgeState);
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

export function parseWorldDocument(path: string, source: string): WorldDocument {
  const parsed = parseMarkdown(source);
  const fm = parsed.frontmatter;
  const heading = extractFirstHeading(parsed.body);
  const raw = {
    id: typeof fm.id === 'string' && fm.id.length > 0 ? fm.id : createId('world'),
    title: typeof fm.title === 'string' ? fm.title : (heading ?? '未命名世界观'),
    genre: fm.genre ?? [],
    themes: fm.themes ?? [],
    tone: fm.tone ?? [],
    era: fm.era,
    location: fm.location,
    institutions: fm.institutions ?? [],
    factions: fm.factions ?? [],
    rules: fm.rules ?? [],
    history: fm.history ?? [],
    socialConflicts: fm.socialConflicts ?? [],
    confirmedFacts: fm.confirmedFacts ?? [],
    unresolvedQuestions: fm.unresolvedQuestions ?? [],
    status: fm.status ?? 'draft',
  };
  const result = WorldSettingSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(`Invalid world setting in ${path}`, formatZodIssues(result.error));
  }
  return { path, setting: result.data, body: parsed.body };
}

export function serializeWorldDocument(setting: WorldSetting, body: string): string {
  return serializeMarkdown(
    {
      id: setting.id,
      type: 'world',
      title: setting.title,
      status: setting.status,
      genre: setting.genre,
      themes: setting.themes,
      tone: setting.tone,
      ...(setting.era ? { era: setting.era } : {}),
      ...(setting.location ? { location: setting.location } : {}),
      institutions: setting.institutions,
      factions: setting.factions,
      rules: setting.rules,
      history: setting.history,
      socialConflicts: setting.socialConflicts,
      confirmedFacts: setting.confirmedFacts,
      unresolvedQuestions: setting.unresolvedQuestions,
    },
    body,
  );
}

export function parseProjectManifest(source: string): ProjectMeta {
  const parsed = parseMarkdown(source);
  const result = ProjectMetaSchema.safeParse(parsed.frontmatter);
  if (!result.success) {
    throw new ValidationError('Invalid project manifest', formatZodIssues(result.error));
  }
  return result.data;
}

export function serializeProjectManifest(meta: ProjectMeta): string {
  return serializeMarkdown(meta, '');
}

export function parseRelationshipDocument(path: string, source: string): CharacterRelationship {
  const parsed = parseMarkdown(source);
  const result = CharacterRelationshipSchema.safeParse(parsed.frontmatter);
  if (!result.success) {
    throw new ValidationError(`Invalid relationship in ${path}`, formatZodIssues(result.error));
  }
  return result.data;
}

export function parseEventDocument(path: string, source: string): StoryEvent {
  const parsed = parseMarkdown(source);
  const result = StoryEventSchema.safeParse(parsed.frontmatter);
  if (!result.success) {
    throw new ValidationError(`Invalid event in ${path}`, formatZodIssues(result.error));
  }
  return result.data;
}
