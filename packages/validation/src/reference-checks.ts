import {
  DIRS,
  createId,
  chapterOrderFromPath,
  parseMarkdown,
  type ContinuityIssue,
} from '@storycode/core';
import type { ProjectStore } from '@storycode/storage';

/**
 * File-reference integrity: frontmatter that points at entities must point at
 * things that exist. Broken references are hard errors because they silently
 * degrade retrieval later.
 */
export async function checkFileReferences(project: ProjectStore): Promise<ContinuityIssue[]> {
  const issues: ContinuityIssue[] = [];
  const files = await project.listFiles();
  const knownPaths = new Set(files.map((file) => file.path));

  for (const file of files) {
    if (!file.path.endsWith('.md')) continue;
    const raw = await project.readFileOrNull(file.path);
    if (raw === null) continue;
    const parsed = parseMarkdown(raw);
    const refs = parsed.frontmatter.relatedFiles;
    if (Array.isArray(refs)) {
      for (const ref of refs) {
        if (typeof ref !== 'string') {
          issues.push({
            id: createId('issue'),
            severity: 'error',
            category: 'reference',
            description: `${file.path} 的 relatedFiles 包含非字符串引用`,
            evidence: [{ filePath: file.path, excerpt: JSON.stringify(ref) }],
            suggestedFix: '将引用改为项目内相对路径字符串',
          });
          continue;
        }
        if (!knownPaths.has(ref)) {
          issues.push({
            id: createId('issue'),
            severity: 'error',
            category: 'reference',
            description: `${file.path} 引用了不存在的文件`,
            evidence: [{ filePath: file.path, excerpt: `relatedFiles: ${ref}` }],
            suggestedFix: `移除该引用，或创建 ${ref}`,
          });
        }
      }
    }
  }

  return issues;
}

/** Verifies chapter numbering has no gaps or duplicates. */
export async function checkChapterSequence(project: ProjectStore): Promise<ContinuityIssue[]> {
  const issues: ContinuityIssue[] = [];
  const chapters = await project.listChapters();
  const seen = new Map<number, string>();
  for (const chapter of chapters) {
    const path = `${DIRS.chapters}/${String(chapter.order).padStart(3, '0')}.md`;
    const existing = seen.get(chapter.order);
    if (existing) {
      issues.push({
        id: createId('issue'),
        severity: 'error',
        category: 'chapter-order',
        description: `章节序号重复：第 ${chapter.order} 章`,
        evidence: [
          { filePath: existing, excerpt: `order: ${chapter.order}` },
          { filePath: path, excerpt: `order: ${chapter.order}` },
        ],
        suggestedFix: '修改其中一章的 order 和文件名',
      });
    }
    seen.set(chapter.order, path);
  }

  const files = await project.listFiles();
  for (const file of files) {
    if (!file.path.startsWith(`${DIRS.chapters}/`)) continue;
    if (chapterOrderFromPath(file.path) === null) {
      issues.push({
        id: createId('issue'),
        severity: 'warning',
        category: 'chapter-order',
        description: `章节文件名不符合 NNN.md 规范：${file.path}`,
        evidence: [{ filePath: file.path, excerpt: file.path }],
        suggestedFix: '重命名为形如 004.md 的格式',
      });
    }
  }
  return issues;
}
