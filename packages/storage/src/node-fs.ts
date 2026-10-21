import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DirEntry, FileStat, FsAdapter } from './fs-adapter.js';

/**
 * Node filesystem adapter.
 *
 * Writes go through a temp file + rename so a crash mid-write cannot truncate a
 * chapter. On filesystems without hard links (exFAT, some network mounts) the
 * rename still works because we use a plain write-then-rename dance; if even
 * that fails we fall back to an in-place write rather than losing user data.
 */
export class NodeFsAdapter implements FsAdapter {
  readonly supportsAtomicReplace = true;

  async readText(absolutePath: string): Promise<string> {
    return fs.readFile(absolutePath, 'utf8');
  }

  async writeText(absolutePath: string, content: string): Promise<void> {
    const dir = path.dirname(absolutePath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = path.join(
      dir,
      `.${path.basename(absolutePath)}.${process.pid}.${Date.now()}.tmp`,
    );
    try {
      await fs.writeFile(tempPath, content, 'utf8');
      await fs.rename(tempPath, absolutePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      // Fallback: direct write. Safer than failing the user's save outright.
      await fs.writeFile(absolutePath, content, 'utf8');
      void error;
    }
  }

  async exists(absolutePath: string): Promise<boolean> {
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(absolutePath: string): Promise<FileStat | null> {
    try {
      const info = await fs.stat(absolutePath);
      return {
        isFile: info.isFile(),
        isDirectory: info.isDirectory(),
        size: info.size,
        mtimeMs: info.mtimeMs,
      };
    } catch {
      return null;
    }
  }

  async readDir(absolutePath: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith('._'))
      .map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? ('directory' as const) : ('file' as const),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async mkdirp(absolutePath: string): Promise<void> {
    await fs.mkdir(absolutePath, { recursive: true });
  }

  async remove(absolutePath: string): Promise<void> {
    await fs.rm(absolutePath, { recursive: true, force: true });
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    await fs.mkdir(path.dirname(toPath), { recursive: true });
    await fs.rename(fromPath, toPath);
  }

  async mtimeMs(absolutePath: string): Promise<number> {
    try {
      return (await fs.stat(absolutePath)).mtimeMs;
    } catch {
      return 0;
    }
  }
}
