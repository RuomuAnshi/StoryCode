/**
 * Line diff used by the review UI. Deliberately dependency-free and small so it
 * can run on the UI thread for chapter-sized documents.
 */

export type DiffOp = 'equal' | 'insert' | 'delete';

export interface DiffLine {
  op: DiffOp;
  text: string;
  /** 1-based line number in the original text (null for inserts). */
  oldLine: number | null;
  /** 1-based line number in the new text (null for deletes). */
  newLine: number | null;
}

/**
 * Classic LCS with a size guard: beyond `maxCells` the function degrades to a
 * coarse "whole block changed" diff instead of freezing the UI.
 */
export function diffLines(before: string, after: string, maxCells = 4_000_000): DiffLine[] {
  const oldLines = splitLines(before);
  const newLines = splitLines(after);
  const n = oldLines.length;
  const m = newLines.length;

  if (n * m > maxCells) {
    const out: DiffLine[] = [];
    for (let i = 0; i < n; i += 1)
      out.push({ op: 'delete', text: oldLines[i] as string, oldLine: i + 1, newLine: null });
    for (let j = 0; j < m; j += 1)
      out.push({ op: 'insert', text: newLines[j] as string, oldLine: null, newLine: j + 1 });
    return out;
  }

  // LCS length table.
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = table[i] as number[];
    const next = table[i + 1] as number[];
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] =
        oldLines[i] === newLines[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ op: 'equal', text: oldLines[i] as string, oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if ((table[i + 1] as number[])[j]! >= (table[i] as number[])[j + 1]!) {
      result.push({ op: 'delete', text: oldLines[i] as string, oldLine: i + 1, newLine: null });
      i += 1;
    } else {
      result.push({ op: 'insert', text: newLines[j] as string, oldLine: null, newLine: j + 1 });
      j += 1;
    }
  }
  while (i < n) {
    result.push({ op: 'delete', text: oldLines[i] as string, oldLine: i + 1, newLine: null });
    i += 1;
  }
  while (j < m) {
    result.push({ op: 'insert', text: newLines[j] as string, oldLine: null, newLine: j + 1 });
    j += 1;
  }
  return result;
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n/g, '\n').split('\n');
}

export interface DiffSummary {
  added: number;
  removed: number;
  changed: boolean;
}

export function summarizeDiff(lines: readonly DiffLine[]): DiffSummary {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.op === 'insert') added += 1;
    else if (line.op === 'delete') removed += 1;
  }
  return { added, removed, changed: added > 0 || removed > 0 };
}

/** Groups consecutive non-equal lines for compact rendering. */
export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export function toHunks(lines: readonly DiffLine[], context = 2): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffLine[] = [];
  let sinceChange = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const oldStart = current.find((l) => l.oldLine !== null)?.oldLine ?? 1;
    const newStart = current.find((l) => l.newLine !== null)?.newLine ?? 1;
    hunks.push({ oldStart, newStart, lines: current });
    current = [];
  };

  for (const line of lines) {
    const isChange = line.op !== 'equal';
    if (isChange) {
      sinceChange = 0;
      current.push(line);
      continue;
    }
    sinceChange += 1;
    if (current.length > 0) {
      if (sinceChange <= context * 2) {
        current.push(line);
      } else {
        // Keep trailing context, then close the hunk.
        const keep = current.slice(0, current.length - (sinceChange - context));
        const buffered = current.slice(current.length - (sinceChange - context));
        current = keep;
        flush();
        current = buffered.filter((l) => l.op === 'equal').slice(-context);
        sinceChange = 0;
      }
    }
  }
  flush();
  return hunks;
}
