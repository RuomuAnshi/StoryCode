export function MarkdownSourceEditor({
  source,
  onChange,
}: {
  source: string;
  onChange(source: string): void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="shrink-0 border-b border-[var(--sc-border)] px-5 py-2 text-[12px] text-[var(--sc-text-muted)]">
        编辑完整 Markdown 文件，包括顶部 YAML 元数据。自动保存；⌘S
        立即保存。格式有误时会保留你的修改并停止写入。
      </p>
      <textarea
        aria-label="Markdown 文件内容"
        value={source}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none bg-[var(--sc-editor-bg)] px-6 py-5 font-mono text-[13px] leading-[1.8] text-[var(--sc-editor-text)] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--sc-accent)]"
      />
    </div>
  );
}
