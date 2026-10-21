/**
 * Identifier generation and stability guarantees.
 *
 * StoryCode keeps entity IDs independent from filenames: renaming a file on disk
 * must never change the identity of the entity stored in that file. IDs are
 * therefore generated once, persisted in YAML frontmatter, and never derived
 * from paths at read time.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Random suffix using the runtime crypto source when available. */
function randomSuffix(length: number): string {
  const bytes = new Uint8Array(length);
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[(bytes[i] ?? 0) % ALPHABET.length];
  }
  return out;
}

export const ID_PREFIXES = [
  'project',
  'chapter',
  'character',
  'world',
  'entity',
  'rule',
  'event',
  'relationship',
  'fact',
  'proposal',
  'changeset',
  'snapshot',
  'conversation',
  'message',
  'task',
  'issue',
  'outline',
  'foreshadow',
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

/**
 * Creates a prefixed, URL-safe, collision-resistant identifier.
 * Example: `createId('chapter')` -> `chapter-k3f9x2m1q8`.
 */
export function createId(prefix: IdPrefix, length = 10): string {
  return `${prefix}-${randomSuffix(length)}`;
}

/** True when `value` is a plausible ID for the given prefix. */
export function isIdOf(value: unknown, prefix: IdPrefix): value is string {
  return (
    typeof value === 'string' && value.startsWith(`${prefix}-`) && value.length > prefix.length + 1
  );
}

/**
 * Serial chapter identifiers are stable and ordered: `chapter-001`.
 * Used for filenames (`001.md`) so the explorer sorts naturally without
 * depending on the display title.
 */
export function chapterFileStem(order: number): string {
  if (!Number.isInteger(order) || order < 1) {
    throw new RangeError(`chapter order must be a positive integer, received ${order}`);
  }
  return String(order).padStart(3, '0');
}

/** Inverse of {@link chapterFileStem}; returns null for non-conforming names. */
export function orderFromChapterStem(stem: string): number | null {
  if (!/^\d{3,}$/.test(stem)) return null;
  const parsed = Number.parseInt(stem, 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}
