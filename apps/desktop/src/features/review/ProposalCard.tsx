import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileX2,
  GitCompare,
  Loader2,
  X,
} from 'lucide-react';
import type { ChangeProposal, FileChange } from '@storycode/core';
import { describeError } from '@storycode/core';
import { Button } from '@/components/Button';
import { cn } from '@/lib/cn';
import { useAgent } from '@/stores/agent-store';
import { useEditor } from '@/stores/editor-store';
import { useWorkspace } from '@/stores/workspace-store';
import { FileDiff } from './FileDiff';

type Decisions = Record<string, 'accepted' | 'rejected'>;

const OPERATION_LABEL: Record<FileChange['operation'], string> = {
  create: '新建',
  update: '修改',
  delete: '删除',
};

const OPERATION_STYLE: Record<FileChange['operation'], string> = {
  create: 'text-[var(--sc-success)]',
  update: 'text-[var(--sc-info)]',
  delete: 'text-[var(--sc-danger)]',
};

/** Review card for a pending proposal: diff, per-file accept/reject, commit. */
export function ProposalCard({ proposal }: { proposal: ChangeProposal }) {
  const project = useWorkspace((state) => state.project);
  const setActiveProposal = useAgent((state) => state.setActiveProposal);
  const openFile = useEditor((state) => state.openFile);
  const refreshTree = useWorkspace((state) => state.refreshTree);

  const [decisions, setDecisions] = useState<Decisions>(() =>
    Object.fromEntries(proposal.changes.map((change) => [change.id, 'accepted' as const])),
  );
  const [expanded, setExpanded] = useState<string | null>(
    proposal.changes.length === 1 ? (proposal.changes[0]?.id ?? null) : null,
  );
  const [impactAcknowledgedId, setImpactAcknowledgedId] = useState<string | null>(null);
  const needsImpactReview = proposal.changes.some(
    (change) => decisions[change.id] === 'accepted' && (change.worldImpact?.files.length ?? 0) > 0,
  );
  const impactAcknowledged = impactAcknowledgedId === proposal.id;

  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const acceptedCount = useMemo(
    () => proposal.changes.filter((change) => decisions[change.id] === 'accepted').length,
    [proposal.changes, decisions],
  );

  const settled = proposal.status !== 'pending';

  const toggle = (id: string) => {
    setDecisions((current) => ({
      ...current,
      [id]: current[id] === 'accepted' ? 'rejected' : 'accepted',
    }));
  };

  const approve = async (acceptAll: boolean) => {
    if (!project) return;
    setCommitting(true);
    setError(null);
    try {
      const result = await project.proposals.commit(proposal, {
        acceptAll,
        acknowledgeWorldImpact: impactAcknowledged,
        ...(acceptAll ? {} : { decisions }),
      });
      await refreshTree();
      // Refresh the index so the agent sees the new content immediately.
      void project.indexer.sync().catch(() => undefined);
      setActiveProposal(null);
      const firstAccepted = result.written[0];
      if (firstAccepted) await openFile(firstAccepted.filePath);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setCommitting(false);
    }
  };

  const rejectAll = async () => {
    if (!project) return;
    setCommitting(true);
    try {
      await project.proposals.reject(proposal, '用户拒绝了该提案');
      setActiveProposal(null);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="sc-fade-in overflow-hidden rounded-xl border border-[var(--sc-accent)]/35 bg-[var(--sc-surface-raised)]">
      <header className="flex items-start gap-2 border-b border-[var(--sc-border)] bg-[var(--sc-accent-soft)]/40 px-3 py-2">
        <GitCompare size={13} className="mt-0.5 shrink-0 text-[var(--sc-accent-text)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-medium text-[var(--sc-text)]">待审阅的文件变更</p>
          <p className="truncate text-[11px] text-[var(--sc-text-muted)]" title={proposal.title}>
            {proposal.title}
          </p>
        </div>
      </header>

      {proposal.rationale && (
        <p className="border-b border-[var(--sc-border)] px-3 py-2 text-[11.5px] leading-relaxed text-[var(--sc-text-secondary)]">
          {proposal.rationale}
        </p>
      )}

      <ul className="divide-y divide-[var(--sc-border)]">
        {proposal.changes.map((change) => {
          const isOpen = expanded === change.id;
          const decision = decisions[change.id] ?? 'accepted';
          return (
            <li key={change.id}>
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : change.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  {isOpen ? (
                    <ChevronDown size={11} className="shrink-0 text-[var(--sc-text-muted)]" />
                  ) : (
                    <ChevronRight size={11} className="shrink-0 text-[var(--sc-text-muted)]" />
                  )}
                  {change.operation === 'create' ? (
                    <FilePlus2 size={11} className="shrink-0 text-[var(--sc-success)]" />
                  ) : change.operation === 'delete' ? (
                    <FileX2 size={11} className="shrink-0 text-[var(--sc-danger)]" />
                  ) : (
                    <GitCompare size={11} className="shrink-0 text-[var(--sc-info)]" />
                  )}
                  <span className="truncate font-mono text-[11px] text-[var(--sc-text-secondary)]">
                    {change.filePath}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 text-[10px] font-medium',
                      OPERATION_STYLE[change.operation],
                    )}
                  >
                    {OPERATION_LABEL[change.operation]}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => toggle(change.id)}
                  disabled={settled}
                  title={decision === 'accepted' ? '点击拒绝此文件' : '点击接受此文件'}
                  className={cn(
                    'inline-flex size-5 shrink-0 items-center justify-center rounded transition-colors',
                    decision === 'accepted'
                      ? 'bg-[var(--sc-success)]/15 text-[var(--sc-success)]'
                      : 'bg-[var(--sc-danger)]/15 text-[var(--sc-danger)]',
                    settled && 'opacity-50',
                  )}
                >
                  {decision === 'accepted' ? <Check size={11} /> : <X size={11} />}
                </button>
              </div>
              {change.worldImpact && (
                <div className="border-t border-[var(--sc-border)] px-3 py-2 text-[11px] text-[var(--sc-text-secondary)]">
                  <p>
                    关联影响：{change.worldImpact.files.length} 个文件可能受影响。仅扫描路径 / ID
                    引用与旧值精确匹配，未检测到匹配不代表没有语义影响。
                  </p>
                  {change.worldImpact.files.map((file) => (
                    <div key={file.filePath} className="mt-2">
                      <button
                        type="button"
                        className="text-[var(--sc-accent-text)] underline"
                        onClick={() => void openFile(file.filePath)}
                      >
                        {file.filePath}
                      </button>
                      {file.evidence.map((evidence) => (
                        <p key={`${evidence.line}:${evidence.reason}`} className="mt-1 break-words">
                          第 {evidence.line} 行 ·{' '}
                          {evidence.reason === 'explicit_reference' ? '路径 / ID 引用' : '旧值匹配'}
                          ：{evidence.excerpt}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {isOpen && (
                <div className="border-t border-[var(--sc-border)]">
                  <FileDiff change={change} />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!settled && needsImpactReview && (
        <label className="flex items-start gap-2 border-t border-[var(--sc-border)] px-3 py-2 text-[11.5px] text-[var(--sc-text-secondary)]">
          <input
            type="checkbox"
            checked={impactAcknowledged}
            onChange={(event) => setImpactAcknowledgedId(event.target.checked ? proposal.id : null)}
          />
          我已查看关联影响提示；本次仅写入已接受的文件，其他内容由我核对。
        </label>
      )}

      {error && (
        <p className="border-t border-[var(--sc-border)] px-3 py-2 text-[11.5px] text-[var(--sc-danger)]">
          {error}
        </p>
      )}

      {!settled && (
        <footer className="flex items-center gap-1.5 border-t border-[var(--sc-border)] bg-[var(--sc-surface)]/40 px-2 py-2">
          <span className="text-[10.5px] text-[var(--sc-text-muted)]">
            {acceptedCount}/{proposal.changes.length} 已接受
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void rejectAll()}
              disabled={committing}
            >
              全部拒绝
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void approve(acceptedCount === proposal.changes.length)}
              disabled={
                committing || acceptedCount === 0 || (needsImpactReview && !impactAcknowledged)
              }
              icon={
                committing ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />
              }
            >
              接受并写入
            </Button>
          </div>
        </footer>
      )}
      {settled && (
        <p className="border-t border-[var(--sc-border)] px-3 py-2 text-[11px] text-[var(--sc-text-muted)]">
          该提案已处理（{proposal.status}）。
        </p>
      )}
    </div>
  );
}
