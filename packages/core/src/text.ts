/**
 * Text measurement helpers. Chinese and Latin text are counted differently:
 * authors care about "字数" which for CJK is characters and for Latin is words.
 */

const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g;

export interface WordCount {
  /** Characters excluding whitespace (CJK-aware "字数"). */
  characters: number;
  /** CJK characters only. */
  cjkCharacters: number;
  /** Latin/word tokens. */
  words: number;
  /** Total reported count: CJK chars + Latin words. */
  total: number;
}

export function countWords(text: string): WordCount {
  if (text.length === 0) {
    return { characters: 0, cjkCharacters: 0, words: 0, total: 0 };
  }
  const cjkMatches = text.match(CJK_PATTERN);
  const cjkCharacters = cjkMatches ? cjkMatches.length : 0;
  const withoutCjk = text.replace(CJK_PATTERN, ' ');
  const words = withoutCjk
    .split(/[\s\u3000]+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  const characters = Array.from(text.replace(/\s|\u3000/g, '')).length;
  return { characters, cjkCharacters, words, total: cjkCharacters + words };
}

/** Strips Markdown syntax for display purposes (not for storage). */
export function stripMarkdown(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First `limit` characters of plain text, for previews and index snippets. */
export function excerpt(body: string, limit = 120): string {
  const plain = stripMarkdown(body);
  const chars = Array.from(plain);
  return chars.length <= limit ? plain : `${chars.slice(0, limit).join('')}…`;
}

/** Strongest simple content hash for version checks (FNV-1a 32-bit, hex). */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Bigram tokenizer that works for Chinese without a dictionary, and keeps
 * Latin words intact. Used by the FTS index.
 */
export function tokenizeForSearch(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  // Latin / digit runs.
  for (const match of lower.matchAll(/[a-z0-9]+/g)) {
    const token = match[0];
    if (token.length > 1) tokens.push(token);
  }
  // CJK: character bigrams plus unigrams so single-character queries still hit.
  const cjkRuns = lower.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]+/g) ?? [];
  for (const run of cjkRuns) {
    const chars = Array.from(run);
    for (let i = 0; i < chars.length; i += 1) {
      tokens.push(chars[i] as string);
      if (i + 1 < chars.length) {
        tokens.push(`${chars[i]}${chars[i + 1]}`);
      }
    }
  }
  return tokens;
}
