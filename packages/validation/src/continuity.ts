import { DIRS, createId, parseMarkdown, type ContinuityIssue } from '@storycode/core';
import type { ProjectStore } from '@storycode/storage';
import { checkChapterSequence, checkFileReferences } from './reference-checks.js';

export interface ContinuityReport {
  issues: ContinuityIssue[];
  checkedFiles: number;
  generatedAt: string;
}

/**
 * Deterministic (non-model) continuity checks.
 *
 * These run without an LLM: they only report what the files actually prove.
 * Model-assisted semantic checks live in the agent package and always cite
 * excerpts, per the spec's "no evidence, no error" rule.
 */
export async function runStructuralChecks(project: ProjectStore): Promise<ContinuityReport> {
  const issues: ContinuityIssue[] = [];
  const files = await project.listFiles();

  issues.push(...(await checkChapterSequence(project)));
  issues.push(...(await checkFileReferences(project)));

  // Character name collisions across files.
  const names = new Map<string, string[]>();
  for (const file of files) {
    if (!file.path.startsWith(`${DIRS.characters}/`)) continue;
    const raw = await project.readFileOrNull(file.path);
    if (raw === null) continue;
    const parsed = parseMarkdown(raw);
    const name = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : '';
    if (name.length === 0) {
      issues.push({
        id: createId('issue'),
        severity: 'warning',
        category: 'character-schema',
        description: `角色文件缺少 name 字段：${file.path}`,
        evidence: [{ filePath: file.path, excerpt: file.path }],
        suggestedFix: '在 YAML frontmatter 中补充 name',
      });
      continue;
    }
    const list = names.get(name) ?? [];
    list.push(file.path);
    names.set(name, list);
  }
  for (const [name, paths] of names) {
    if (paths.length > 1) {
      issues.push({
        id: createId('issue'),
        severity: 'error',
        category: 'character-schema',
        description: `存在同名角色：${name}`,
        evidence: paths.map((path) => ({ filePath: path, excerpt: `name: ${name}` })),
        suggestedFix: '确认是否为同一角色的重复文件，或为角色改名',
      });
    }
  }

  // Relationship targets must resolve.
  for (const file of files) {
    if (!file.path.startsWith(`${DIRS.plot}/`) || !file.path.endsWith('relationships.md')) continue;
    const raw = await project.readFileOrNull(file.path);
    if (raw === null) continue;
    const parsed = parseMarkdown(raw);
    for (const line of parsed.body.split('\n')) {
      const match = /^\s*-\s*([a-z][a-z0-9-]+)\s*->\s*([a-z][a-z0-9-]+)/i.exec(line);
      if (!match) continue;
      for (const id of [match[1], match[2]]) {
        if (!id) continue;
        const exists = files.some((candidate) => {
          if (!candidate.path.startsWith(`${DIRS.characters}/`)) return false;
          return candidate.path.includes(id);
        });
        if (!exists) {
          issues.push({
            id: createId('issue'),
            severity: 'warning',
            category: 'relationship',
            description: `关系条目引用了未知角色 ID：${id}`,
            evidence: [{ filePath: file.path, excerpt: line.trim() }],
            suggestedFix: '确认角色 ID 是否正确，或先创建该角色',
          });
        }
      }
    }
  }

  return {
    issues: issues.sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
    checkedFiles: files.length,
    generatedAt: new Date().toISOString(),
  };
}

function severityRank(severity: ContinuityIssue['severity']): number {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}

/** Merges deterministic and model-reported issues, deduplicated by description. */
export function mergeReports(...reports: readonly ContinuityIssue[][]): ContinuityIssue[] {
  const seen = new Set<string>();
  const merged: ContinuityIssue[] = [];
  for (const report of reports) {
    for (const issue of report) {
      const key = `${issue.category}|${issue.description}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(issue);
    }
  }
  return merged.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}
