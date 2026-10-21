import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import type { SearchHit } from '@storycode/storage';
import type { FileNode } from '@storycode/core';
import { Dialog } from '@/components/Dialog';
import { useWorkspace } from '@/stores/workspace-store';
import { useEditor } from '@/stores/editor-store';
import { cn } from '@/lib/cn';

interface SearchPaletteProps {
  open: boolean;
  onClose(): void;
}

/** Fast project search over the in-memory index (FTS-like ranking). */
export function SearchPalette({ open, onClose }: SearchPaletteProps) {
  const project = useWorkspace((state) => state.project);
  const tree = useWorkspace((state) => state.tree);
  const openFile = useEditor((state) => state.openFile);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  const hits = useMemo<SearchHit[]>(() => {
    if (!project || query.trim().length === 0) return [];
    return project.indexer.index.search(query.trim(), { limit: 20 });
  }, [project, query]);

  // With an empty query, list openable files so this doubles as a quick nav.
  const fallback = useMemo<SearchHit[]>(() => listFiles(tree).slice(0, 20), [tree]);
  const items: SearchHit[] = query.trim().length === 0 ? fallback : hits;

  const activate = (index: number) => {
    const item = items[index];
    if (!item) return;
    void openFile(item.path);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title="搜索" width="lg">
      <div className="space-y-2">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--sc-text-muted)]"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((current) => Math.min(items.length - 1, current + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((current) => Math.max(0, current - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                activate(selected);
              }
            }}
            placeholder="搜索章节、人物、世界观…"
            className="w-full rounded-lg border border-[var(--sc-border)] bg-[var(--sc-surface-raised)] py-2 pl-8 pr-3 text-[13px] text-[var(--sc-text)] placeholder:text-[var(--sc-text-muted)] focus:border-[var(--sc-accent)]/60 focus:outline-none"
          />
        </div>

        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 && (
            <p className="py-6 text-center text-[12px] text-[var(--sc-text-muted)]">
              {query.trim().length === 0 ? '项目中没有可打开的文件。' : '没有匹配结果。'}
            </p>
          )}
          {items.map((item, index) => {
            const path = item.path;
            const title = item.title.length > 0 ? item.title : path;
            const snippet = item.snippet;
            return (
              <button
                key={`${path}-${index}`}
                type="button"
                onMouseEnter={() => setSelected(index)}
                onClick={() => activate(index)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  index === selected
                    ? 'bg-[var(--sc-accent-soft)]'
                    : 'hover:bg-[var(--sc-surface-raised)]',
                )}
              >
                <FileText size={12} className="mt-0.5 shrink-0 text-[var(--sc-text-muted)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] text-[var(--sc-text)]">
                    {title}
                  </span>
                  {snippet.length > 0 && (
                    <span className="block truncate text-[11px] text-[var(--sc-text-muted)]">
                      {snippet}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-[var(--sc-text-muted)]">
                  {path}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

/** Flattens the file tree into navigable search rows. */
function listFiles(nodes: FileNode[]): SearchHit[] {
  const out: SearchHit[] = [];
  const walk = (list: FileNode[]) => {
    for (const node of list) {
      if (node.children) {
        walk(node.children);
      } else if (node.name.endsWith('.md')) {
        out.push({
          path: node.path,
          title: node.name.replace(/\.md$/i, ''),
          kind: node.kind === 'chapter' ? 'chapter' : 'other',
          score: 0,
          snippet: '',
          startLine: 0,
          endLine: 0,
          matchedTerms: [],
        });
      }
    }
  };
  walk(nodes);
  return out;
}
