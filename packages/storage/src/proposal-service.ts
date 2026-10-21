/**
 * Proposal lifecycle: draft -> review -> commit.
 *
 * This is the ONLY component allowed to turn model output into real files, and
 * it enforces three invariants:
 *   1. every change is version-checked against the file it was generated from;
 *   2. a snapshot is taken before writing anything;
 *   3. if any file in the set fails, already-written files are rolled back so
 *      the project never ends up half-updated.
 */

import {
  META_PATHS,
  ChangeProposalSchema,
  StoryCodeError,
  VersionConflictError,
  contentHash,
  createId,
  isProtectedPath,
  normalizeRelativePath,
  type ChangeDecision,
  type ChangeOperation,
  type ChangeProposal,
  type CommitResult,
  type FileChange,
  type VersionCheck,
} from '@storycode/core';
import { collectWorldImpact } from './world-impact.js';
import type { FsAdapter } from './fs-adapter.js';
import type { ProjectStore } from './project-store.js';
import type { SnapshotStore } from './snapshot-store.js';

export interface NewFileChange {
  operation: ChangeOperation;
  filePath: string;
  nextContent?: string;
  kind?: FileChange['kind'];
  summary?: string;
  expectedBaseContentHash?: string | null;
  dependsOnPaths?: string[];
  dependencyContentHashes?: Record<string, string>;
}

export interface CreateProposalInput {
  title: string;
  rationale?: string;
  sourceTaskId?: string;
  changes: NewFileChange[];
}

export class ProposalService {
  constructor(
    private readonly fs: FsAdapter,
    private readonly project: ProjectStore,
    private readonly snapshots: SnapshotStore,
  ) {}

  private proposalPath(id: string): string {
    return `${META_PATHS.proposals}/${id}.json`;
  }

  private async save(proposal: ChangeProposal): Promise<void> {
    await this.fs.mkdirp(this.project.resolve(META_PATHS.proposals));
    await this.fs.writeText(
      this.project.resolve(this.proposalPath(proposal.id)),
      JSON.stringify(proposal, null, 2),
    );
  }

  async load(id: string): Promise<ChangeProposal | null> {
    const raw = await this.project.readFileOrNull(this.proposalPath(id));
    if (raw === null) return null;
    try {
      return ChangeProposalSchema.parse(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async list(): Promise<ChangeProposal[]> {
    const entries = await this.project.listDirectory(META_PATHS.proposals);
    const out: ChangeProposal[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
      const proposal = await this.load(entry.name.replace(/\.json$/, ''));
      if (proposal) out.push(proposal);
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Creates a proposal. Content for `update`/`delete` is captured from disk so
   * the review UI can show a real diff even if the file changes later.
   */
  async create(input: CreateProposalInput): Promise<ChangeProposal> {
    if (input.changes.length === 0) {
      throw new StoryCodeError('VALIDATION_FAILED', '提案必须包含至少一项文件变更');
    }
    const seen = new Set<string>();
    const changes: FileChange[] = [];
    let requiresExplicitConfirmation = false;

    for (const rawChange of input.changes) {
      const filePath = normalizeRelativePath(rawChange.filePath);
      if (isProtectedPath(filePath)) {
        throw new StoryCodeError('PATH_UNSAFE', `不允许修改受保护的文件：${filePath}`);
      }
      if (seen.has(filePath)) {
        throw new StoryCodeError('VALIDATION_FAILED', `同一提案内重复修改文件：${filePath}`);
      }
      seen.add(filePath);

      const exists = await this.project.exists(filePath);
      const previousContent = exists ? await this.project.readFile(filePath) : null;
      const baseHash = previousContent === null ? null : contentHash(previousContent);
      if (
        rawChange.expectedBaseContentHash !== undefined &&
        rawChange.expectedBaseContentHash !== baseHash
      ) {
        throw new VersionConflictError(filePath, rawChange.expectedBaseContentHash, baseHash);
      }

      if (rawChange.operation === 'create' && exists) {
        throw new StoryCodeError('ALREADY_EXISTS', `文件已存在，无法新建：${filePath}`, {
          filePath,
        });
      }
      if ((rawChange.operation === 'update' || rawChange.operation === 'delete') && !exists) {
        throw new StoryCodeError(
          'NOT_FOUND',
          `文件不存在，无法${rawChange.operation === 'delete' ? '删除' : '修改'}：${filePath}`,
          {
            filePath,
          },
        );
      }
      if (rawChange.operation === 'delete') requiresExplicitConfirmation = true;

      const dependencyContentHashes: Record<string, string> = {};
      for (const [dependency, expected] of Object.entries(
        rawChange.dependencyContentHashes ?? {},
      )) {
        const safe = normalizeRelativePath(dependency);
        const actual = await this.project.fileHash(safe);
        if (actual !== expected) throw new VersionConflictError(safe, expected, actual);
        dependencyContentHashes[safe] = expected;
      }
      changes.push({
        ...(Object.keys(dependencyContentHashes).length ? { dependencyContentHashes } : {}),
        id: createId('fact'),
        ...(rawChange.dependsOnPaths
          ? { dependsOnPaths: rawChange.dependsOnPaths.map(normalizeRelativePath) }
          : {}),
        operation: rawChange.operation,
        filePath,
        baseContentHash: baseHash,
        nextContent: rawChange.operation === 'delete' ? '' : (rawChange.nextContent ?? ''),
        previousContent,
        summary: rawChange.summary ?? describeChange(rawChange.operation, filePath),
        kind: rawChange.kind ?? 'other',
      });
    }

    for (const change of changes) {
      if (change.filePath.startsWith('world/') && change.operation !== 'create') {
        change.worldImpact = await collectWorldImpact(
          this.project,
          change.filePath,
          change.previousContent ?? '',
          change.nextContent,
        );
      }
    }

    if (changes.length > 3) requiresExplicitConfirmation = true;

    const proposal: ChangeProposal = {
      id: createId('proposal'),
      title: input.title,
      rationale: input.rationale ?? '',
      ...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
      createdAt: new Date().toISOString(),
      status: 'pending',
      changes,
      decisions: {},
      requiresExplicitConfirmation,
    };
    await this.save(proposal);
    return proposal;
  }

  /** Re-checks every file hash right before review or commit. */
  async checkVersions(proposal: ChangeProposal): Promise<VersionCheck[]> {
    const checks: VersionCheck[] = [];
    for (const change of proposal.changes) {
      if (this.decisionOf(proposal, change.id) === 'rejected') continue;
      const exists = await this.project.exists(change.filePath);
      const actualHash = exists ? contentHash(await this.project.readFile(change.filePath)) : null;
      let status: VersionCheck['status'];
      if (change.operation === 'create') {
        status = actualHash === null ? 'ok' : 'conflict';
      } else if (actualHash === null) {
        status = 'missing';
      } else {
        status = actualHash === change.baseContentHash ? 'ok' : 'conflict';
      }
      checks.push({
        filePath: change.filePath,
        expectedHash: change.baseContentHash,
        actualHash,
        status,
      });
    }
    return checks;
  }

  /**
   * Applies the accepted subset. Rolls back on partial failure and records the
   * snapshot id needed for one-click restore.
   */
  async commit(
    proposal: ChangeProposal,
    options: {
      acceptAll?: boolean;
      decisions?: Record<string, ChangeDecision>;
      acknowledgeWorldImpact?: boolean;
    } = {},
  ): Promise<CommitResult> {
    const decisions: Record<string, ChangeDecision> = {
      ...proposal.decisions,
      ...(options.decisions ?? {}),
    };
    if (options.acceptAll === true) {
      for (const change of proposal.changes) decisions[change.id] = 'accepted';
    }

    const accepted = proposal.changes.filter((change) => decisions[change.id] === 'accepted');
    if (accepted.length === 0) {
      throw new StoryCodeError('VALIDATION_FAILED', '没有已接受的文件变更可提交');
    }

    for (const change of accepted) {
      if (!change.filePath.startsWith('world/') || change.operation === 'create') continue;
      const currentImpact = await collectWorldImpact(
        this.project,
        change.filePath,
        change.previousContent ?? '',
        change.nextContent,
      );
      if (
        !change.worldImpact ||
        JSON.stringify(currentImpact) !== JSON.stringify(change.worldImpact)
      )
        throw new StoryCodeError(
          'VALIDATION_FAILED',
          '世界观关联依据已变化，请重新生成提案并审核影响。',
        );
      if (currentImpact.files.length && options.acknowledgeWorldImpact !== true)
        throw new StoryCodeError('VALIDATION_FAILED', '请先查看并确认世界观变更的关联影响提示。');
    }

    // A relationship may only be committed if its referenced characters exist
    // already or are accepted in this same change set.
    for (const change of accepted) {
      for (const dependency of change.dependsOnPaths ?? []) {
        const planned = proposal.changes.find((candidate) => candidate.filePath === dependency);
        if (planned?.operation === 'delete' && decisions[planned.id] === 'accepted') {
          throw new StoryCodeError('VALIDATION_FAILED', `依赖文件将被删除：${dependency}`);
        }
        if (
          !(await this.project.exists(dependency)) &&
          !accepted.some(
            (candidate) => candidate.filePath === dependency && candidate.operation === 'create',
          )
        ) {
          throw new StoryCodeError('VALIDATION_FAILED', `请同时接受依赖的角色文件：${dependency}`);
        }
      }
    }

    for (const change of accepted) {
      for (const [dependency, expected] of Object.entries(change.dependencyContentHashes ?? {})) {
        const actual = await this.project.fileHash(normalizeRelativePath(dependency));
        if (actual !== expected) throw new VersionConflictError(dependency, expected, actual);
      }
    }

    // Version gate for every accepted change before touching the disk.
    for (const change of accepted) {
      const exists = await this.project.exists(change.filePath);
      const actualHash = exists ? contentHash(await this.project.readFile(change.filePath)) : null;
      if (change.operation === 'create') {
        if (actualHash !== null) throw new VersionConflictError(change.filePath, null, actualHash);
      } else if (actualHash !== change.baseContentHash) {
        throw new VersionConflictError(change.filePath, change.baseContentHash, actualHash);
      }
    }

    if (proposal.requiresExplicitConfirmation && options.acceptAll !== true) {
      const allDecided = proposal.changes.every((change) => decisions[change.id] !== undefined);
      if (!allDecided && Object.keys(options.decisions ?? {}).length === 0) {
        throw new StoryCodeError('VALIDATION_FAILED', '该提案需要逐项确认后才能提交');
      }
    }

    const snapshot = await this.snapshots.capture(
      `提交前快照：${proposal.title}`,
      accepted.map((change) => change.filePath),
    );

    const written: CommitResult['written'] = [];
    try {
      for (const change of accepted) {
        if (change.operation === 'delete') {
          await this.project.deleteFile(change.filePath);
          written.push({ filePath: change.filePath, contentHash: '', operation: 'delete' });
        } else {
          const result = await this.project.writeFile(change.filePath, change.nextContent);
          written.push({
            filePath: change.filePath,
            contentHash: result.hash,
            operation: change.operation,
          });
        }
      }
    } catch (error) {
      // Best-effort rollback of everything written so far.
      for (const item of written) {
        const entry = snapshot.entries.find((candidate) => candidate.path === item.filePath);
        if (!entry) continue;
        try {
          if (entry.content === null) {
            await this.project.deleteFile(item.filePath);
          } else {
            await this.project.writeFile(item.filePath, entry.content);
          }
        } catch {
          // Swallowed: the original error is what the user needs to see.
        }
      }
      const failed: ChangeProposal = { ...proposal, status: 'failed', decisions };
      await this.save(failed);
      throw new StoryCodeError(
        'STORAGE_ERROR',
        `提交失败，已回滚：${error instanceof Error ? error.message : String(error)}`,
        {
          snapshotId: snapshot.id,
        },
      );
    }

    const allAccepted = proposal.changes.every((change) => decisions[change.id] === 'accepted');
    const noneAccepted = proposal.changes.every((change) => decisions[change.id] !== 'accepted');
    const status: ChangeProposal['status'] = noneAccepted
      ? 'rejected'
      : allAccepted
        ? 'accepted'
        : 'partially_accepted';

    await this.save({ ...proposal, status, decisions });
    await this.project.touch();

    return {
      proposalId: proposal.id,
      committedAt: new Date().toISOString(),
      written,
      snapshotId: snapshot.id,
      rollbackToken: snapshot.id,
    };
  }

  async reject(proposal: ChangeProposal, reason?: string): Promise<ChangeProposal> {
    const next: ChangeProposal = {
      ...proposal,
      status: 'rejected',
      rationale: reason ? `${proposal.rationale}\n\n[拒绝原因] ${reason}` : proposal.rationale,
      decisions: Object.fromEntries(
        proposal.changes.map((change) => [change.id, 'rejected' as const]),
      ),
    };
    await this.save(next);
    return next;
  }

  /** Records per-item decisions without committing. */
  async recordDecisions(
    proposal: ChangeProposal,
    decisions: Record<string, ChangeDecision>,
  ): Promise<ChangeProposal> {
    const next: ChangeProposal = {
      ...proposal,
      decisions: { ...proposal.decisions, ...decisions },
    };
    await this.save(next);
    return next;
  }

  private decisionOf(proposal: ChangeProposal, changeId: string): ChangeDecision {
    return proposal.decisions[changeId] ?? 'pending';
  }
}

function describeChange(operation: ChangeOperation, filePath: string): string {
  switch (operation) {
    case 'create':
      return `新建 ${filePath}`;
    case 'update':
      return `修改 ${filePath}`;
    case 'delete':
      return `删除 ${filePath}`;
  }
}
