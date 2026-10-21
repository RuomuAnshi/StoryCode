/**
 * Markdown <-> ProseMirror JSON conversion for the editor.
 *
 * Round-trip fidelity is a hard requirement (spec §9.2), so the conversion is
 * isolated here and covered by tests rather than being assumed to work.
 */

import { MarkdownManager } from '@tiptap/markdown';
import type { JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

let manager: MarkdownManager | null = null;

/** Lazily builds the shared markdown manager (marked + StarterKit schema). */
function getManager(): MarkdownManager {
  manager ??= new MarkdownManager({
    extensions: [StarterKit],
    markedOptions: { gfm: true, breaks: false },
  });
  return manager;
}

/** Parses Markdown into a ProseMirror document. */
export function markdownToDoc(markdown: string): JSONContent {
  return getManager().parse(markdown);
}

/** Serializes a ProseMirror document back to Markdown. */
export function docToMarkdown(doc: JSONContent): string {
  return getManager().serialize(doc);
}

/**
 * Normalizes text for comparison: trims trailing whitespace per line and
 * collapses runs of blank lines, matching what the serializer emits.
 */
export function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when the two markdown strings are equivalent for editing purposes. */
export function markdownEquals(left: string, right: string): boolean {
  return normalizeMarkdown(left) === normalizeMarkdown(right);
}
