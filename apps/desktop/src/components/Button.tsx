import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-[var(--sc-accent)] text-white hover:bg-[var(--sc-accent-hover)] active:brightness-95 disabled:opacity-45',
  secondary:
    'bg-[var(--sc-surface-raised)] text-[var(--sc-text)] border border-[var(--sc-border)] hover:border-[var(--sc-border-strong)] hover:bg-[var(--sc-surface-overlay)] disabled:opacity-45',
  ghost:
    'text-[var(--sc-text-secondary)] hover:text-[var(--sc-text)] hover:bg-[var(--sc-surface-raised)] disabled:opacity-40',
  danger: 'bg-red-600/90 text-white hover:bg-red-600 disabled:opacity-45',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12.5px] gap-1.5 rounded-md',
  md: 'h-8.5 px-3.5 text-[13px] gap-2 rounded-lg',
  lg: 'h-10 px-5 text-[14px] gap-2 rounded-lg',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  fullWidth = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex select-none items-center justify-center font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-accent)]/50',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      {children}
      {iconRight}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  active = false,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sc-accent)]/50',
        active
          ? 'bg-[var(--sc-accent-soft)] text-[var(--sc-accent-text)]'
          : 'text-[var(--sc-text-muted)] hover:bg-[var(--sc-surface-raised)] hover:text-[var(--sc-text)]',
        'disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
