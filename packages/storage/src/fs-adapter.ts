/**
 * Filesystem boundary.
 *
 * The rest of the app never touches `node:fs` or the Tauri IPC directly: it
 * talks to a `FsAdapter`. That keeps the storage layer testable in-memory and
 * lets the desktop build swap in the Rust bridge (which enforces the same
 * containment rules a second time, on the privileged side).
 */

export interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
}

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

export interface FsAdapter {
  /** Hints whether writes should assume POSIX atomic rename semantics. */
  readonly supportsAtomicReplace: boolean;

  readText(absolutePath: string): Promise<string>;
  writeText(absolutePath: string, content: string): Promise<void>;
  exists(absolutePath: string): Promise<boolean>;
  stat(absolutePath: string): Promise<FileStat | null>;
  readDir(absolutePath: string): Promise<DirEntry[]>;
  mkdirp(absolutePath: string): Promise<void>;
  remove(absolutePath: string): Promise<void>;
  rename(fromPath: string, toPath: string): Promise<void>;
  /** Best-effort modification time in ms; 0 when unavailable. */
  mtimeMs(absolutePath: string): Promise<number>;
}
