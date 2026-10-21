/**
 * Markdown + YAML frontmatter round-trip.
 *
 * StoryCode treats the Markdown files as the authoritative source of truth, so
 * this module must never lose or silently reorder user content. The parser
 * keeps the frontmatter raw text alongside the body and only re-serializes the
 * frontmatter block; the body is passed through byte-for-byte.
 */

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface ParsedMarkdown {
  /** Parsed frontmatter object; empty object when absent. */
  frontmatter: Record<string, unknown>;
  /** Raw frontmatter YAML text (without fences); empty string when absent. */
  frontmatterRaw: string;
  /** Body content exactly as it appeared after the closing fence. */
  body: string;
  /** True when the source document began with a YAML frontmatter block. */
  hasFrontmatter: boolean;
}

const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function parseMarkdown(source: string): ParsedMarkdown {
  const match = FRONTMATTER_PATTERN.exec(source);
  if (!match) {
    return {
      frontmatter: {},
      frontmatterRaw: '',
      body: source.replace(/^\uFEFF/, ''),
      hasFrontmatter: false,
    };
  }
  const raw = match[1] ?? '';
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new MarkdownFrontmatterError(`Invalid YAML frontmatter: ${reason}`, raw);
  }
  if (parsed === null || parsed === undefined) {
    parsed = {};
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MarkdownFrontmatterError('Frontmatter must be a YAML mapping', raw);
  }
  // The closing delimiter consumes one newline; the remaining single newline is
  // the blank separator line, which is not part of the body.
  const body = source.slice(match[0].length).replace(/^\r?\n/, '');
  return {
    frontmatter: parsed as Record<string, unknown>,
    frontmatterRaw: raw,
    body,
    hasFrontmatter: true,
  };
}

export class MarkdownFrontmatterError extends Error {
  override readonly name = 'MarkdownFrontmatterError';
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
  }
}

/**
 * Serializes frontmatter + body.
 * The body is written verbatim so user-authored text is never reformatted.
 */
export function serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const yamlText = stringifyYaml(frontmatter, {
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  }).trimEnd();
  // Exactly one blank line separates the frontmatter from the body, so that
  // parse(serialize(x)) returns the body unchanged.
  return `---\n${yamlText}\n---\n\n${body}`;
}

/**
 * Replaces only the frontmatter of `source`, leaving the body untouched.
 * Used when metadata changes but the author's prose must not be rewritten.
 */
export function replaceFrontmatter(
  source: string,
  updater: (current: Record<string, unknown>) => Record<string, unknown>,
): string {
  const parsed = parseMarkdown(source);
  const next = updater({ ...parsed.frontmatter });
  return serializeMarkdown(next, parsed.body);
}

/** Extracts the first ATX heading text from a Markdown body, if any. */
export function extractFirstHeading(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) return (match[1] ?? '').trim();
  }
  return null;
}
