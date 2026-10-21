import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseMarkdown } from '@storycode/core';

/** Read-only rendering never serializes or writes the source document. */
export function MarkdownPreview({ source }: { source: string }) {
  const parsed = useMemo(() => {
    try {
      return parseMarkdown(source);
    } catch {
      return null;
    }
  }, [source]);
  if (!parsed)
    return (
      <div>
        <p role="alert">元数据格式有误，显示原文以便检查。</p>
        <pre className="whitespace-pre-wrap">{source}</pre>
      </div>
    );
  return (
    <>
      {parsed.hasFrontmatter && (
        <details className="mb-5 rounded-lg border border-[var(--sc-border)] p-3 text-[12px] text-[var(--sc-text-muted)]">
          <summary className="cursor-pointer">文件元数据</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap">{parsed.frontmatterRaw}</pre>
        </details>
      )}
      <article className="sc-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            img: ({ alt }) => (
              <span className="text-[var(--sc-text-muted)]">[图片：{alt || '未命名'}]</span>
            ),
          }}
        >
          {parsed.body}
        </ReactMarkdown>
      </article>
    </>
  );
}
