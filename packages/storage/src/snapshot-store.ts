/**
 * Snapshots and rollback.
 *
 * Every AI commit takes a snapshot of the affected files first, keyed by a
 * rollback token. Restoring is itself non-destructive: if a file has unsaved
 * changes we refuse and ask the caller to reconcile, per the spec.
 */

import { META_PATHS, contentHash, createId } from '@storycode/core';
import type { FsAdapter } from './fs-adapter.js';
import type { ProjectStore } from './project-store.js';

export interface SnapshotEntry {
  /** Project-relative path. */
  path: string;
  /** Content at snapshot time; null when the file did not exist. */
  content: string | null;
  hash: string | null;
}

export interface Snapshot {
  id: string;
  label: string;
  createdAt: string;
  entries: SnapshotEntry[];
}

export interface RestoreResult {
  restored: string[];
  skipped: Array<{ path: string; reason: string }>;
}

export class SnapshotStore {
  constructor(
    private readonly fs: FsAdapter,
    private readonly project: ProjectStore,
  ) {}

  private snapshotPath(id: string): string {
    return `${META_PATHS.snapshots}/${id}.json`;
  }

  async capture(label: string, paths: readonly string[]): Promise<Snapshot> {
    const id = createId('snapshot');
    const unique = [...new Set(paths)];
    const entries: SnapshotEntry[] = [];
    for (const path of unique) {
      const content = await this.project.readFileOrNull(path);
      entries.push({ path, content, hash: content === null ? null : contentHash(content) });
    }
    const snapshot: Snapshot = { id, label, createdAt: new Date().toISOString(), entries };
    await this.fs.mkdirp(this.project.resolve(META_PATHS.snapshots));
    await this.fs.writeText(
      this.project.resolve(this.snapshotPath(id)),
      JSON.stringify(snapshot, null, 2),
    );
    return snapshot;
  }

  async load(id: string): Promise<Snapshot | null> {
    const raw = await this.project.readFileOrNull(this.snapshotPath(id));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as Snapshot;
    } catch {
      return null;
    }
  }

  async list(): Promise<
    Array<Pick<Snapshot, 'id' | 'label' | 'createdAt'> & { fileCount: number }>
  > {
    const entries = await this.project.listDirectory(META_PATHS.snapshots);
    const out: Array<Pick<Snapshot, 'id' | 'label' | 'createdAt'> & { fileCount: number }> = [];
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
      const snapshot = await this.load(entry.name.replace(/\.json$/, ''));
      if (snapshot) {
        out.push({
          id: snapshot.id,
          label: snapshot.label,
          createdAt: snapshot.createdAt,
          fileCount: snapshot.entries.length,
        });
      }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Restores a snapshot. Files whose current hash differs from `expectedHashes`
   * are skipped unless `force` is set, so we never silently clobber the author.
   */
  async restore(
    id: string,
    options: { expectedHashes?: Readonly<Record<string, string | null>>; force?: boolean } = {},
  ): Promise<RestoreResult> {
    const snapshot = await this.load(id);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${id}`);
    }
    const restored: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];

    for (const entry of snapshot.entries) {
      const expected = options.expectedHashes?.[entry.path];
      if (!options.force && expected !== undefined) {
        const current = await this.project.readFileOrNull(entry.path);
        const currentHash = current === null ? null : contentHash(current);
        if (currentHash !== expected) {
          skipped.push({ path: entry.path, reason: '文件在快照后被修改，已跳过以避免覆盖' });
          continue;
        }
      }
      if (entry.content === null) {
        await this.project.deleteFile(entry.path).catch(() => undefined);
      } else {
        await this.project.writeFile(entry.path, entry.content);
      }
      restored.push(entry.path);
    }
    return { restored, skipped };
  }
}
