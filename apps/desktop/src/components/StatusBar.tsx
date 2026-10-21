import { CircleAlert, Cloud, HardDrive, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatWordCount } from '@/lib/format';
import type { SaveStatus } from '@/stores/editor-store';

interface StatusBarProps {
  wordCount: number;
  chapterTitle: string | null;
  saveStatus: SaveStatus;
  lastSavedAt: string | null;
  agentBusy: boolean;
  agentPhase: string;
  modelLabel: string;
  modelConfigured: boolean;
}

const SAVE_LABELS: Record<SaveStatus, string> = {
  saved: '已保存',
  dirty: '未保存',
  saving: '保存中…',
  error: '保存失败',
};

export function StatusBar({
  wordCount,
  chapterTitle,
  saveStatus,
  lastSavedAt,
  agentBusy,
  agentPhase,
  modelLabel,
  modelConfigured,
}: StatusBarProps) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-[var(--sc-border)] bg-[var(--sc-surface)] px-3 text-[11.5px] text-[var(--sc-text-muted)]">
      <span className="tabular-nums">{formatWordCount(wordCount)} 字</span>
      {chapterTitle && (
        <>
          <span className="h-3 w-px bg-[var(--sc-border)]" />
          <span className="max-w-[22ch] truncate" title={chapterTitle}>
            {chapterTitle}
          </span>
        </>
      )}

      <span className="h-3 w-px bg-[var(--sc-border)]" />
      <span
        className={cn(
          'inline-flex items-center gap-1.5',
          saveStatus === 'error' && 'text-[var(--sc-danger)]',
          saveStatus === 'dirty' && 'text-[var(--sc-warning)]',
          saveStatus === 'saving' && 'text-[var(--sc-text-secondary)]',
        )}
        title={
          lastSavedAt ? `最后保存：${new Date(lastSavedAt).toLocaleTimeString('zh-CN')}` : undefined
        }
      >
        {saveStatus === 'saving' ? (
          <Loader2 size={11} className="animate-spin" />
        ) : saveStatus === 'error' ? (
          <CircleAlert size={11} />
        ) : (
          <HardDrive size={11} />
        )}
        {SAVE_LABELS[saveStatus]}
      </span>

      <div className="ml-auto flex items-center gap-4">
        <span className="inline-flex items-center gap-1.5">
          {agentBusy ? (
            <>
              <Sparkles size={11} className="sc-pulse text-[var(--sc-accent-text)]" />
              <span className="text-[var(--sc-accent-text)]">
                AI 运行中{agentPhase ? ` · ${agentPhase}` : ''}
              </span>
            </>
          ) : (
            <>
              <Sparkles size={11} />
              <span>AI 空闲</span>
            </>
          )}
        </span>
        <span className="h-3 w-px bg-[var(--sc-border)]" />
        <span
          className={cn(
            'inline-flex items-center gap-1.5',
            !modelConfigured && 'text-[var(--sc-warning)]',
          )}
          title={modelConfigured ? '模型已配置' : '尚未配置模型'}
        >
          <Cloud size={11} />
          {modelConfigured ? modelLabel : '未配置模型'}
        </span>
      </div>
    </footer>
  );
}
