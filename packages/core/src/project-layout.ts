/**
 * On-disk project layout constants and helpers.
 *
 * Markdown files are the authoritative source; `.storycode/` holds derived data
 * (snapshots, proposals, conversations) that can be regenerated or discarded
 * without losing the novel.
 */

export const STORY_FILE = 'STORY.md';
export const MANIFEST_FILE = 'project.json';
export const META_DIR = '.storycode';

export const DIRS = {
  chapters: 'chapters',
  characters: 'characters',
  world: 'world',
  plot: 'plot',
} as const;

export type ProjectDir = (typeof DIRS)[keyof typeof DIRS];

export const META_PATHS = {
  snapshots: `${META_DIR}/snapshots`,
  proposals: `${META_DIR}/proposals`,
  conversations: `${META_DIR}/conversations`,
  logs: `${META_DIR}/logs`,
} as const;

export const WORLD_FILES = {
  overview: `${DIRS.world}/overview.md`,
  rules: `${DIRS.world}/rules.md`,
  history: `${DIRS.world}/history.md`,
  organizations: `${DIRS.world}/organizations.md`,
} as const;

export const PLOT_FILES = {
  outline: `${DIRS.plot}/outline.md`,
  timeline: `${DIRS.plot}/timeline.md`,
  relationships: `${DIRS.plot}/relationships.md`,
  foreshadowing: `${DIRS.plot}/foreshadowing.md`,
} as const;

/** Every directory that must exist in a freshly created project. */
export const REQUIRED_DIRS = [
  DIRS.chapters,
  DIRS.characters,
  DIRS.world,
  DIRS.plot,
  META_PATHS.snapshots,
  META_PATHS.proposals,
  META_PATHS.conversations,
  META_PATHS.logs,
] as const;

/** Classifies a project-relative path into a coarse content kind. */
export function classifyPath(
  path: string,
): 'chapter' | 'character' | 'world' | 'plot' | 'meta' | 'root' | 'other' {
  if (path.startsWith(`${META_DIR}/`)) return 'meta';
  if (path.startsWith(`${DIRS.chapters}/`)) return 'chapter';
  if (path.startsWith(`${DIRS.characters}/`)) return 'character';
  if (path.startsWith(`${DIRS.world}/`)) return 'world';
  if (path.startsWith(`${DIRS.plot}/`)) return 'plot';
  if (!path.includes('/')) return 'root';
  return 'other';
}

/** True for files the agent may never propose to modify. */
export function isProtectedPath(path: string): boolean {
  if (path.startsWith(`${META_DIR}/`)) return true;
  if (path === MANIFEST_FILE) return true;
  return false;
}

/** Chapter file path for a 1-based order: `chapters/001.md`. */
export function chapterPath(order: number): string {
  return `${DIRS.chapters}/${String(order).padStart(3, '0')}.md`;
}

/** Character file path for a numeric index: `characters/character-001.md`. */
export function characterPath(index: number): string {
  return `${DIRS.characters}/character-${String(index).padStart(3, '0')}.md`;
}

/** Parses a chapter order from `chapters/NNN.md`; null when not a chapter. */
export function chapterOrderFromPath(path: string): number | null {
  const match = /^chapters\/(\d{3,})\.md$/.exec(path);
  if (!match) return null;
  const parsed = Number.parseInt(match[1] as string, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}
