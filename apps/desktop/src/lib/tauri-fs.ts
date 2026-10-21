/**
 * `FsAdapter` implementation backed by the Tauri IPC bridge.
 *
 * The Rust side only accepts project-relative paths and re-validates
 * containment, so this adapter converts absolute paths back to relative ones.
 * Anything outside the project root is refused here *and* in Rust.
 */

import { dirname, relative, sep } from './path.js';
import type { DirEntry, FileStat, FsAdapter } from '@storycode/storage';
import { desktop } from './tauri.js';

export class TauriFsAdapter implements FsAdapter {
  /** exFAT and some network shares reject rename-over-existing. */
  readonly supportsAtomicReplace = false;

  constructor(private readonly root: string) {}

  private toRelative(absolutePath: string): string {
    const normalizedRoot = this.root.endsWith(sep) ? this.root.slice(0, -1) : this.root;
    if (absolutePath === normalizedRoot) return '';
    const relativePath = relative(normalizedRoot, absolutePath);
    if (relativePath.startsWith('..')) {
      throw new Error(`路径越界：${absolutePath} 不在项目目录内`);
    }
    return relativePath.split(sep).join('/');
  }

  async readText(absolutePath: string): Promise<string> {
    return desktop.readTextFile(this.toRelative(absolutePath));
  }

  async writeText(absolutePath: string, content: string): Promise<void> {
    await desktop.writeTextFile(this.toRelative(absolutePath), content);
  }

  async exists(absolutePath: string): Promise<boolean> {
    try {
      return await desktop.fileExists(this.toRelative(absolutePath));
    } catch {
      return false;
    }
  }

  async stat(absolutePath: string): Promise<FileStat | null> {
    try {
      const info = await desktop.statFile(this.toRelative(absolutePath));
      if (!info.exists) return null;
      return {
        isFile: !info.is_directory,
        isDirectory: info.is_directory,
        size: info.size,
        mtimeMs: info.modified_ms,
      };
    } catch {
      return null;
    }
  }

  async readDir(absolutePath: string): Promise<DirEntry[]> {
    const entries = await desktop.listDirectory(this.toRelative(absolutePath));
    return entries.map((entry) => ({ name: entry.name, kind: entry.kind }));
  }

  async mkdirp(absolutePath: string): Promise<void> {
    const rel = this.toRelative(absolutePath);
    if (rel === '') return;
    await desktop.createDirectory(rel);
  }

  async remove(absolutePath: string): Promise<void> {
    await desktop.deleteFile(this.toRelative(absolutePath));
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    await desktop.renameEntry(this.toRelative(fromPath), this.toRelative(toPath));
  }

  async mtimeMs(absolutePath: string): Promise<number> {
    try {
      const info = await desktop.statFile(this.toRelative(absolutePath));
      return info.modified_ms;
    } catch {
      return 0;
    }
  }
}

/** Joins a project root with a project-relative path. */
export function joinRoot(root: string, relativePath: string): string {
  if (relativePath === '') return root;
  const normalized = relativePath.split('/').join(sep);
  return root.endsWith(sep) ? `${root}${normalized}` : `${root}${sep}${normalized}`;
}

/** Parent directory of an absolute path. */
export function parentDir(absolutePath: string): string {
  return dirname(absolutePath);
}
