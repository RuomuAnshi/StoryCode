import { useState } from 'react';
import { describeError } from '@storycode/core';
import { desktop } from '@/lib/tauri';
import { FileText } from 'lucide-react';
import type { Citation } from '@storycode/core';
import { useEditor } from '@/stores/editor-store';

/** Source files the agent consulted, each clickable to open the file. */
export function Citations({ citations }: { citations: Citation[] }) {
  const [error, setError] = useState<string | null>(null);
  const openFile = useEditor((state) => state.openFile);
  if (citations.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {error && (
        <p role="alert" className="text-[11px] text-[var(--sc-danger)]">
          {error}
        </p>
      )}
      {citations.map((citation, index) => (
        <button
          key={`${citation.filePath}-${index}`}
          type="button"
          onClick={() => {
            if (citation.sourceUrl) {
              setError(null);
              void desktop
                .openWebUrl(citation.sourceUrl)
                .catch((caught: unknown) => setError(describeError(caught)));
            } else {
              void openFile(citation.filePath);
            }
          }}
          title={citation.sourceUrl ?? citation.excerpt ?? citation.filePath}
          className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--sc-border)] bg-[var(--sc-surface-raised)] px-1.5 py-0.5 text-[10.5px] text-[var(--sc-text-muted)] transition-colors hover:border-[var(--sc-accent)]/40 hover:text-[var(--sc-accent-text)]"
        >
          <FileText size={9} className="shrink-0" />
          <span className="truncate">
            {citation.sourceUrl
              ? citation.title || new URL(citation.sourceUrl).hostname
              : citation.filePath}
          </span>
        </button>
      ))}
    </div>
  );
}
