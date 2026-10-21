import { contentHash, parseMarkdown, type WorldImpact } from '@storycode/core';
import type { ProjectStore } from './project-store.js';

/** Evidence of possible impact only; text overlap never proves a story contradiction. */
export async function collectWorldImpact(
  project: ProjectStore,
  filePath: string,
  previousContent: string,
  nextContent: string,
): Promise<WorldImpact> {
  const previous = parseMarkdown(previousContent);
  const next = parseMarkdown(nextContent);
  // Only the setting fields carry evidence, not revision history or author requests.
  const fields = [
    'title',
    'genre',
    'themes',
    'tone',
    'era',
    'location',
    'institutions',
    'factions',
    'rules',
    'history',
    'socialConflicts',
    'unresolvedQuestions',
  ];
  const terms = new Set<string>();
  const strings = (value: unknown): void => {
    if (typeof value === 'string' && value.trim().length >= 2) terms.add(value.trim());
    else if (Array.isArray(value)) for (const item of value as unknown[]) strings(item);
    else if (value && typeof value === 'object')
      for (const item of Object.values(value)) strings(item);
  };
  for (const field of fields) {
    if (JSON.stringify(previous.frontmatter[field]) !== JSON.stringify(next.frontmatter[field]))
      strings(previous.frontmatter[field]);
  }
  // Body-only edits still find removed exact lines, without guessing their meaning.
  const nextLines = new Set(next.body.split('\n').map((line) => line.trim()));
  for (const line of previous.body.split('\n')) {
    const text = line.trim();
    if (text.length >= 4 && !text.startsWith('#') && !nextLines.has(text)) terms.add(text);
  }
  const worldId: unknown = previous.frontmatter.id;
  const references = [
    filePath,
    ...(typeof worldId === 'string' && worldId.length >= 2 ? [worldId] : []),
  ];
  const report: WorldImpact = { scope: 'explicit-and-text', files: [] };
  const files = (await project.listFiles())
    .filter((file) => file.path.endsWith('.md') && file.path !== filePath)
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    const raw = await project.readFile(file.path);
    const evidence: WorldImpact['files'][number]['evidence'] = [];
    for (const [index, line] of raw.split('\n').entries()) {
      const reference = references.find((value) => line.includes(value));
      const explicit = reference ? line.indexOf(reference) : -1;
      const term = explicit < 0 ? [...terms].find((value) => line.includes(value)) : undefined;
      if (explicit < 0 && !term) continue;
      const position = explicit >= 0 ? explicit : line.indexOf(term!);
      const start = Math.max(0, position - 80);
      evidence.push({
        line: index + 1,
        excerpt: line.slice(start, start + 400),
        reason: explicit >= 0 ? 'explicit_reference' : 'text_match',
      });
      if (evidence.length === 5) break;
    }
    if (evidence.length)
      report.files.push({ filePath: file.path, contentHash: contentHash(raw), evidence });
  }
  return report;
}
