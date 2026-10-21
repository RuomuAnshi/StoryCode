import { useEffect, useRef } from 'react';
import { ArrowUp, Square, Sparkles, MessageSquare, ListTree } from 'lucide-react';
import type { AgentMode } from '@storycode/core';
import { useAgent } from '@/stores/agent-store';
import { cn } from '@/lib/cn';
import { Kbd } from '@/components/primitives';

const MODES: Array<{ id: AgentMode; label: string; hint: string; icon: typeof Sparkles }> = [
  { id: 'ask', label: '询问', hint: '分析小说、解释设定，不修改文件', icon: MessageSquare },
  { id: 'plan', label: '规划', hint: '生成方案与提案，不直接写入', icon: ListTree },
  { id: 'agent', label: '执行', hint: '生成文件提案，经你审核后写入', icon: Sparkles },
];

/** Message input with mode switch, stop button, and selection context. */
export function AgentComposer() {
  const webEnabled = useAgent((state) => state.webEnabled);
  const setWebEnabled = useAgent((state) => state.setWebEnabled);
  const draft = useAgent((state) => state.draft);
  const setDraft = useAgent((state) => state.setDraft);
  const mode = useAgent((state) => state.mode);
  const setMode = useAgent((state) => state.setMode);
  const send = useAgent((state) => state.send);
  const cancel = useAgent((state) => state.cancel);
  const status = useAgent((state) => state.status);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const running = status === 'running';

  // Grow with content, capped so the transcript keeps most of the height.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 168)}px`;
  }, [draft]);

  const submit = () => {
    if (running) return;
    void send();
  };

  return (
    <div className="shrink-0 border-t border-[var(--sc-border)] bg-[var(--sc-surface)] p-2.5">
      {webEnabled && (
        <p className="mb-1.5 px-1 text-[10.5px] text-[var(--sc-text-muted)]">
          联网已开启：查询词会发送至 DuckDuckGo，网页内容供 AI 参考。
        </p>
      )}
      <div
        className={cn(
          'rounded-xl border border-[var(--sc-border)] bg-[var(--sc-surface-raised)]',
          'focus-within:border-[var(--sc-accent)]/50 focus-within:ring-1 focus-within:ring-[var(--sc-accent)]/20',
        )}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={
            mode === 'ask'
              ? '询问故事、人物或设定…'
              : mode === 'plan'
                ? '描述你想规划的方案…'
                : '描述创作目标或修改要求，也可以让 AI 帮你梳理下一步'
          }
          className={cn(
            'block max-h-42 w-full resize-none bg-transparent px-3 pt-2.5 pb-1',
            'text-[13px] leading-relaxed text-[var(--sc-text)] placeholder:text-[var(--sc-text-muted)]',
            'focus:outline-none',
          )}
          aria-label="给 AI 助手的消息"
        />
        <div className="flex items-center gap-1 px-2 pb-1.5">
          <div className="flex items-center gap-0.5">
            {MODES.map(({ id, label, hint, icon: Icon }) => (
              <button
                key={id}
                type="button"
                title={hint}
                onClick={() => setMode(id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] transition-colors',
                  mode === id
                    ? 'bg-[var(--sc-accent-soft)] text-[var(--sc-accent-text)]'
                    : 'text-[var(--sc-text-muted)] hover:bg-[var(--sc-surface-overlay)] hover:text-[var(--sc-text-secondary)]',
                )}
              >
                <Icon size={11} />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="联网搜索"
            aria-pressed={webEnabled}
            disabled={running}
            title="开启后，AI 可将查询词发送至 DuckDuckGo，并读取公开网页"
            onClick={() => setWebEnabled(!webEnabled)}
            className={cn(
              'rounded-md px-1.5 py-1 text-[11px]',
              webEnabled
                ? 'bg-[var(--sc-accent-soft)] text-[var(--sc-accent-text)]'
                : 'text-[var(--sc-text-muted)]',
            )}
          >
            联网
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            {running ? (
              <button
                type="button"
                onClick={cancel}
                className="inline-flex items-center gap-1 rounded-md bg-[var(--sc-surface-overlay)] px-2 py-1 text-[11px] text-[var(--sc-text-secondary)] transition-colors hover:text-[var(--sc-danger)]"
              >
                <Square size={9} fill="currentColor" />
                停止
              </button>
            ) : (
              <>
                <span className="hidden items-center gap-1 text-[10.5px] text-[var(--sc-text-muted)] sm:flex">
                  <Kbd>⏎</Kbd>
                  发送
                </span>
                <button
                  type="button"
                  onClick={submit}
                  disabled={draft.trim().length === 0}
                  aria-label="发送"
                  className={cn(
                    'inline-flex size-6.5 items-center justify-center rounded-md transition-colors',
                    draft.trim().length === 0
                      ? 'bg-[var(--sc-surface-overlay)] text-[var(--sc-text-muted)]'
                      : 'bg-[var(--sc-accent)] text-white hover:bg-[var(--sc-accent-hover)]',
                  )}
                >
                  <ArrowUp size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
