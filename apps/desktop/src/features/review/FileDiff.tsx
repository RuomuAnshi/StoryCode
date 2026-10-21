import { useMemo } from 'react';
import { diffLines } from 'diff';
import type { FileChange } from '@storycode/core';
import { cn } from '@/lib/cn';

/**
 * Unified diff for a proposed file change.
 *
 * Line counts stay small because proposals are per-file, so the whole diff is
 * rendered without virtualization.
 */
export function FileDiff({ change }: { change: FileChange }) {
  const hunks = useMemo(() => buildDiff(change), [change]);

  if (change.operation === 'delete') {
    return (
      <div className="px-2.5 py-2 text-[11.5px] text-[var(--sc-danger)]">
        此变更将删除文件 <span className="font-mono">{change.filePath}</span>
      </div>
    );
  }

  if (hunks.length === 0) {
    return <p className="px-2.5 py-2 text-[11.5px] text-[var(--sc-text-muted)]">内容没有差异。</p>;
  }

  return (
    <div className="max-h-72 overflow-auto bg-[var(--sc-code-bg,var(--sc-surface))]">
      <table className="w-full border-collapse font-mono text-[11px] leading-[1.55]">
        <tbody>
          {hunks.map((line, index) =>
            line.type === 'hunk' ? (
              <tr key={`hunk-${index}`}>
                <td
                  colSpan={4}
                  className="bg-[var(--sc-surface-raised)] px-2 py-0.5 text-[10px] text-[var(--sc-text-muted)]"
                >
                  {line.header}
                </td>
              </tr>
            ) : (
              <tr
                key={`${line.type}-${index}`}
                className={cn(
                  line.type === 'add' && 'bg-[var(--sc-success)]/10',
                  line.type === 'remove' && 'bg-[var(--sc-danger)]/10',
                )}
              >
                <td
                  className={cn(
                    'w-8 select-none border-r border-[var(--sc-border)] px-1 text-right align-top text-[10px] text-[var(--sc-text-muted)]',
                  )}
                >
                  {line.oldLine ?? ''}
                </td>
                <td
                  className={cn(
                    'w-8 select-none border-r border-[var(--sc-border)] px-1 text-right align-top text-[10px] text-[var(--sc-text-muted)]',
                  )}
                >
                  {line.newLine ?? ''}
                </td>
                <td
                  className={cn(
                    'w-3.5 select-none px-1 align-top',
                    line.type === 'add' && 'text-[var(--sc-success)]',
                    line.type === 'remove' && 'text-[var(--sc-danger)]',
                    line.type === 'context' && 'text-transparent',
                  )}
                >
                  {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
                </td>
                <td
                  className={cn(
                    'whitespace-pre-wrap break-all pr-2 align-top',
                    line.type === 'add' && 'text-[var(--sc-success)]',
                    line.type === 'remove' && 'text-[var(--sc-danger)]',
                    line.type === 'context' && 'text-[var(--sc-text-secondary)]',
                  )}
                >
                  {line.text.length > 0 ? line.text : '\u00a0'}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

interface DiffLine {
  type: 'add' | 'remove' | 'context';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

interface Hunk {
  type: 'hunk';
  header: string;
}

const CONTEXT_LINES = 3;

/** Builds a unified diff with @@ hunk headers, collapsing long unchanged runs. */
function buildDiff(change: FileChange): Array<DiffLine | Hunk> {
  const before = change.previousContent ?? '';
  const after = change.nextContent;
  const parts = diffLines(before, after);

  // First expand to a full line list so hunk boundaries can be computed.
  const all: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const part of parts) {
    const lines = part.value.split('\n');
    // diffLines keeps a trailing '' when the value ends with a newline.
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    for (const text of lines) {
      if (part.added) {
        all.push({ type: 'add', text, oldLine: null, newLine });
        newLine += 1;
      } else if (part.removed) {
        all.push({ type: 'remove', text, oldLine, newLine: null });
        oldLine += 1;
      } else {
        all.push({ type: 'context', text, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
      }
    }
  }

  const changedIndexes = all
    .map((line, index) => (line.type === 'context' ? -1 : index))
    .filter((index) => index >= 0);
  if (changedIndexes.length === 0) return [];

  // Keep changed lines plus a few lines of surrounding context.
  const keep = new Set<number>();
  for (const index of changedIndexes) {
    for (let offset = -CONTEXT_LINES; offset <= CONTEXT_LINES; offset += 1) {
      const target = index + offset;
      if (target >= 0 && target < all.length) keep.add(target);
    }
  }

  const output: Array<DiffLine | Hunk> = [];
  let previousKept = -2;
  for (let index = 0; index < all.length; index += 1) {
    if (!keep.has(index)) continue;
    if (index !== previousKept + 1) {
      const hunkLines = all.slice(index);
      const first = hunkLines[0];
      const oldStart = first?.oldLine ?? oldLine;
      const newStart = first?.newLine ?? newLine;
      output.push({ type: 'hunk', header: `@@ -${oldStart} +${newStart} @@` });
    }
    output.push(all[index]!);
    previousKept = index;
  }
  return output;
}
