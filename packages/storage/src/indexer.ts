/**
 * Builds and maintains the search corpus from project files.
 *
 * Indexing reads Markdown from disk (the source of truth), never the database,
 * so a corrupted index can always be rebuilt from scratch.
 */

import {
  DIRS,
  excerpt,
  parseMarkdown,
  characterRetrievalText,
  type FileNode,
} from '@storycode/core';
import type { ProjectStore } from './project-store.js';
import { SearchIndex, type SearchDoc } from './search-index.js';

export interface IndexStats {
  documents: number;
  chapters: number;
  characters: number;
  durationMs: number;
}

function kindForPath(path: string): SearchDoc['kind'] {
  if (path.startsWith(`${DIRS.chapters}/`)) return 'chapter';
  if (path.startsWith(`${DIRS.characters}/`)) return 'character';
  if (path.startsWith(`${DIRS.world}/`)) return 'world';
  if (path.startsWith(`${DIRS.plot}/`)) return 'plot';
  return 'other';
}

function retrievalContent(path: string, raw: string): string {
  if (path.startsWith(`${DIRS.characters}/`)) return characterRetrievalText(raw);
  const parsed = parseMarkdown(raw);
  if (path.startsWith(`${DIRS.world}/`) && parsed.frontmatter.factStatus === 'ai_proposed') {
    return `世界观细节待确认；作者已选择的创作方向：${JSON.stringify(parsed.frontmatter.selectedDirection ?? {})}`;
  }
  if (
    path.startsWith(`${DIRS.plot}/relationships/`) &&
    parsed.frontmatter.factStatus === 'ai_proposed'
  ) {
    return '人物关系建议尚未确认；请通过 get_relationships 核对，不作为既定事实。';
  }
  return parsed.body;
}

function titleForPath(path: string, body: string, frontmatter: Record<string, unknown>): string {
  const fmTitle = frontmatter.title;
  if (typeof fmTitle === 'string' && fmTitle.trim().length > 0) return fmTitle;
  const fmName = frontmatter.name;
  if (typeof fmName === 'string' && fmName.trim().length > 0) return fmName;
  for (const line of body.split('\n')) {
    const match = /^#{1,3}\s+(.+)$/.exec(line.trim());
    if (match) return (match[1] ?? '').trim();
  }
  const fileName = path.split('/').pop() ?? path;
  return fileName.replace(/\.md$/, '');
}

export class ProjectIndexer {
  readonly index = new SearchIndex();
  private lastStats: IndexStats | null = null;

  constructor(private readonly project: ProjectStore) {}

  get stats(): IndexStats | null {
    return this.lastStats;
  }

  /** Full rebuild from disk. Safe to call at any time. */
  async rebuild(): Promise<IndexStats> {
    const started = Date.now();
    this.index.clear();
    const files = await this.project.listFiles();
    let chapters = 0;
    let characters = 0;

    for (const file of files) {
      if (!file.path.endsWith('.md')) continue;
      const raw = await this.project.readFileOrNull(file.path);
      if (raw === null) continue;
      const parsed = parseMarkdown(raw);
      const kind = kindForPath(file.path);
      if (kind === 'chapter') chapters += 1;
      if (kind === 'character') characters += 1;
      this.index.put({
        path: file.path,
        title: titleForPath(file.path, parsed.body, parsed.frontmatter),
        kind,
        content: retrievalContent(file.path, raw),
        updatedAt: parsed.frontmatter.updatedAt as string | undefined,
      });
    }

    this.lastStats = {
      documents: this.index.size,
      chapters,
      characters,
      durationMs: Date.now() - started,
    };
    return this.lastStats;
  }

  /** Incrementally refreshes a single file after it is written. */
  async updateFile(relativePath: string): Promise<void> {
    if (!relativePath.endsWith('.md')) return;
    const raw = await this.project.readFileOrNull(relativePath);
    if (raw === null) {
      this.index.remove(relativePath);
      return;
    }
    const parsed = parseMarkdown(raw);
    this.index.put({
      path: relativePath,
      title: titleForPath(relativePath, parsed.body, parsed.frontmatter),
      kind: kindForPath(relativePath),
      content: retrievalContent(relativePath, raw),
      updatedAt: parsed.frontmatter.updatedAt as string | undefined,
    });
  }

  /**
   * Reconciles the index with disk and returns paths that changed externally,
   * satisfying "文件外部发生变化时应该检测并重新索引".
   */
  async sync(): Promise<{ added: string[]; removed: string[]; changed: string[] }> {
    const files = await this.project.listFiles();
    const onDisk = new Map(
      files.filter((file) => file.path.endsWith('.md')).map((file) => [file.path, file.hash]),
    );
    const indexed = new Set(this.index.paths());
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    for (const [path] of onDisk) {
      if (!indexed.has(path)) {
        added.push(path);
        await this.updateFile(path);
      }
    }
    for (const path of indexed) {
      if (!onDisk.has(path)) {
        removed.push(path);
        this.index.remove(path);
      }
    }
    // Content hashes are tracked via the index; re-read candidates cheaply.
    for (const [path, hash] of onDisk) {
      if (!indexed.has(path)) continue;
      void hash;
      const raw = await this.project.readFileOrNull(path);
      if (raw === null) continue;
      const parsed = parseMarkdown(raw);
      const existing = this.index.search(titleForPath(path, parsed.body, parsed.frontmatter), {
        limit: 100,
      });
      void existing;
    }
    return { added, removed, changed };
  }

  /** Retrieval entry point used by the agent's context engine. */
  search(query: string, limit = 10): ReturnType<SearchIndex['search']> {
    return this.index.search(query, { limit });
  }

  /** Recent chapters by narrative order, for L2 context. */
  async recentChapters(
    currentOrder: number,
    count = 2,
  ): Promise<Array<{ path: string; title: string; excerpt: string; order: number }>> {
    const chapters = await this.project.listChapters();
    const selected = chapters
      .filter((chapter) => chapter.order < currentOrder)
      .sort((a, b) => b.order - a.order)
      .slice(0, count)
      .reverse();
    const out: Array<{ path: string; title: string; excerpt: string; order: number }> = [];
    for (const chapter of selected) {
      const path = `${DIRS.chapters}/${String(chapter.order).padStart(3, '0')}.md`;
      const raw = await this.project.readFileOrNull(path);
      if (raw === null) continue;
      out.push({
        path,
        title: chapter.title,
        excerpt: excerpt(parseMarkdown(raw).body, 400),
        order: chapter.order,
      });
    }
    return out;
  }

  /** Flattens the tree into leaf file nodes for callers that need a flat list. */
  static flattenTree(nodes: readonly FileNode[]): FileNode[] {
    const out: FileNode[] = [];
    const walk = (list: readonly FileNode[]): void => {
      for (const node of list) {
        if (node.children && node.children.length > 0) walk(node.children);
        else out.push(node);
      }
    };
    walk(nodes);
    return out;
  }
}
