import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Small caps-style section label used across sidebars. */
export function SectionLabel({
  children,
  className,
  action,
}: {
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn('flex items-center justify-between px-3 ', className)}>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-[var(--sc-text-muted)]">
        {children}
      </span>
      {action}
    </div>
  );
}

/** Modal-free inline banner for errors and notices. */
export function Banner({
  tone = 'info',
  children,
  action,
  onDismiss,
}: {
  tone?: 'info' | 'warning' | 'error' | 'success';
  children: ReactNode;
  action?: ReactNode;
  onDismiss?: () => void;
}) {
  const tones = {
    info: 'border-[var(--sc-info)]/30 bg-[var(--sc-info)]/8 text-[var(--sc-text)]',
    warning: 'border-[var(--sc-warning)]/35 bg-[var(--sc-warning)]/8 text-[var(--sc-text)]',
    error: 'border-[var(--sc-danger)]/35 bg-[var(--sc-danger)]/8 text-[var(--sc-text)]',
    success: 'border-[var(--sc-success)]/35 bg-[var(--sc-success)]/8 text-[var(--sc-text)]',
  } as const;
  const glyphs = { info: 'ⓘ', warning: '⚠', error: '✕', success: '✓' } as const;
  const glyphColors = {
    info: 'text-[var(--sc-info)]',
    warning: 'text-[var(--sc-warning)]',
    error: 'text-[var(--sc-danger)]',
    success: 'text-[var(--sc-success)]',
  } as const;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed',
        tones[tone],
      )}
    >
      <span className={cn('mt-px shrink-0 text-[12px]', glyphColors[tone])} aria-hidden>
        {glyphs[tone]}
      </span>
      <div className="min-w-0 flex-1 break-words">{children}</div>
      {action}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="关闭提示"
          className="shrink-0 text-[var(--sc-text-muted)] transition-colors hover:text-[var(--sc-text)]"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/** Keyboard-key chip, for shortcuts in menus and tooltips. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-[var(--sc-border)] bg-[var(--sc-surface-raised)] px-1 font-mono text-[10.5px] leading-4 text-[var(--sc-text-muted)]">
      {children}
    </kbd>
  );
}

/** Centered empty state. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      {icon && <div className="text-[var(--sc-text-muted)] opacity-70">{icon}</div>}
      <div className="space-y-1">
        <p className="text-[14px] font-medium text-[var(--sc-text)]">{title}</p>
        {description && (
          <p className="mx-auto max-w-sm text-[12.5px] leading-relaxed text-[var(--sc-text-muted)]">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Thin divider matching the chrome. */
export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px shrink-0 bg-[var(--sc-border)]', className)} />;
}

/** Spinner sized for inline use. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
    />
  );
}

/** A labelled field wrapper with consistent spacing. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-[12px] font-medium text-[var(--sc-text-secondary)]"
      >
        {label}
      </label>
      {children}
      {hint && <p className="text-[11.5px] leading-relaxed text-[var(--sc-text-muted)]">{hint}</p>}
    </div>
  );
}

export const inputClass = cn(
  'w-full rounded-lg border border-[var(--sc-border)] bg-[var(--sc-surface-raised)] px-2.5 py-1.5',
  'text-[13px] text-[var(--sc-text)] placeholder:text-[var(--sc-text-muted)]',
  'transition-colors focus:border-[var(--sc-accent)]/60 focus:outline-none focus:ring-2 focus:ring-[var(--sc-accent)]/20',
);
