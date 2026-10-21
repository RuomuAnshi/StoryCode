import type { DirEntry, FileStat, FsAdapter } from './fs-adapter.js';

/**
 * In-memory adapter used by unit/integration tests and by the browser preview
 * build. Paths are normalized to POSIX form.
 */
export class MemoryFsAdapter implements FsAdapter {
  readonly supportsAtomicReplace = true;
  private readonly files = new Map<string, { content: string; mtimeMs: number }>();
  private readonly dirs = new Set<string>(['/']);

  private normalize(path: string): string {
    const unified = path.replace(/\\/g, '/');
    const absolute = unified.startsWith('/');
    const parts: string[] = [];
    for (const segment of unified.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') {
        parts.pop();
        continue;
      }
      parts.push(segment);
    }
    return `${absolute ? '/' : ''}${parts.join('/')}` || '/';
  }

  async readText(absolutePath: string): Promise<string> {
    const entry = this.files.get(this.normalize(absolutePath));
    if (!entry) throw new Error(`ENOENT: ${absolutePath}`);
    return entry.content;
  }

  async writeText(absolutePath: string, content: string): Promise<void> {
    const path = this.normalize(absolutePath);
    this.files.set(path, { content, mtimeMs: Date.now() });
    // Create implied parents.
    const segments = path.split('/').filter(Boolean);
    for (let i = 1; i < segments.length; i += 1) {
      this.dirs.add(`/${segments.slice(0, i).join('/')}`);
    }
  }

  async exists(absolutePath: string): Promise<boolean> {
    const path = this.normalize(absolutePath);
    return this.files.has(path) || this.dirs.has(path);
  }

  async stat(absolutePath: string): Promise<FileStat | null> {
    const path = this.normalize(absolutePath);
    const entry = this.files.get(path);
    if (entry) {
      return {
        isFile: true,
        isDirectory: false,
        size: entry.content.length,
        mtimeMs: entry.mtimeMs,
      };
    }
    if (this.dirs.has(path)) {
      return { isFile: false, isDirectory: true, size: 0, mtimeMs: 0 };
    }
    return null;
  }

  async readDir(absolutePath: string): Promise<DirEntry[]> {
    const base = this.normalize(absolutePath);
    const prefix = base === '/' ? '/' : `${base}/`;
    const seen = new Map<string, 'file' | 'directory'>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const [head] = rest.split('/');
      if (!head) continue;
      seen.set(head, rest.includes('/') ? 'directory' : 'file');
    }
    for (const path of this.dirs) {
      if (!path.startsWith(prefix) || path === base) continue;
      const rest = path.slice(prefix.length);
      const [head] = rest.split('/');
      if (head && !seen.has(head)) seen.set(head, 'directory');
    }
    return [...seen.entries()]
      .map(([name, kind]) => ({ name, kind }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async mkdirp(absolutePath: string): Promise<void> {
    const path = this.normalize(absolutePath);
    const segments = path.split('/').filter(Boolean);
    for (let i = 1; i <= segments.length; i += 1) {
      this.dirs.add(`/${segments.slice(0, i).join('/')}`);
    }
  }

  async remove(absolutePath: string): Promise<void> {
    const path = this.normalize(absolutePath);
    this.files.delete(path);
    this.dirs.delete(path);
    const prefix = `${path}/`;
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
    for (const key of [...this.dirs]) {
      if (key.startsWith(prefix)) this.dirs.delete(key);
    }
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const from = this.normalize(fromPath);
    const to = this.normalize(toPath);
    const entry = this.files.get(from);
    if (!entry) throw new Error(`ENOENT: ${fromPath}`);
    await this.writeText(to, entry.content);
    this.files.delete(from);
  }

  async mtimeMs(absolutePath: string): Promise<number> {
    return this.files.get(this.normalize(absolutePath))?.mtimeMs ?? 0;
  }

  /** Test helper: every stored path, sorted. */
  listAllPaths(): string[] {
    return [...this.files.keys()].sort();
  }
}
