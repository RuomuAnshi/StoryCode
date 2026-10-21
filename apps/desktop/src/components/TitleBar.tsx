import { Moon, PanelLeft, PanelRight, Search, Settings, Sun } from 'lucide-react';
import { IconButton } from './Button';
import { cn } from '@/lib/cn';
import type { Theme } from '@/lib/use-theme';

interface TitleBarProps {
  projectName: string | null;
  theme: Theme;
  onToggleTheme(): void;
  onOpenSettings(): void;
  onToggleExplorer(): void;
  onToggleAgent(): void;
  onOpenSearch(): void;
  explorerOpen: boolean;
  agentOpen: boolean;
}

/**
 * Top chrome. The window uses `titleBarStyle: Overlay` on macOS, so this bar
 * doubles as the drag region; interactive children opt out of dragging.
 */
export function TitleBar({
  projectName,
  theme,
  onToggleTheme,
  onOpenSettings,
  onToggleExplorer,
  onToggleAgent,
  onOpenSearch,
  explorerOpen,
  agentOpen,
}: TitleBarProps) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--sc-border)] bg-[var(--sc-surface)] pl-20 pr-3"
    >
      <div data-tauri-drag-region className="flex min-w-0 items-center gap-2.5">
        <span className="select-none text-[13px] font-semibold tracking-tight text-[var(--sc-text)]">
          StoryCode
        </span>
        {projectName && (
          <>
            <span className="text-[var(--sc-text-muted)]">/</span>
            <span
              data-tauri-drag-region
              className="truncate text-[12.5px] text-[var(--sc-text-secondary)]"
              title={projectName}
            >
              {projectName}
            </span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton label="搜索（⌘K）" onClick={onOpenSearch}>
          <Search size={15} />
        </IconButton>
        <IconButton
          label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          onClick={onToggleTheme}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
        <IconButton label="设置" onClick={onOpenSettings}>
          <Settings size={15} />
        </IconButton>
        <div className="mx-1 h-4 w-px bg-[var(--sc-border)]" />
        <IconButton
          label={explorerOpen ? '隐藏文件栏' : '显示文件栏'}
          onClick={onToggleExplorer}
          active={explorerOpen}
        >
          <PanelLeft size={15} />
        </IconButton>
        <IconButton
          label={agentOpen ? '隐藏 AI 助手' : '显示 AI 助手'}
          onClick={onToggleAgent}
          active={agentOpen}
        >
          <PanelRight size={15} />
        </IconButton>
      </div>
    </header>
  );
}

/** Resize handle between panes. */
export function ResizeHandle({
  onPointerDown,
  dragging,
  className,
}: {
  onPointerDown(event: React.PointerEvent<HTMLDivElement>): void;
  dragging: boolean;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className={cn(
        'group relative z-10 w-px shrink-0 cursor-col-resize bg-[var(--sc-border)]',
        'before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-[""]',
        'hover:bg-[var(--sc-accent)]/60',
        dragging && 'bg-[var(--sc-accent)]',
        className,
      )}
    />
  );
}
