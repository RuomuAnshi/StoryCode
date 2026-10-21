/** Formatting helpers shared by the UI. */

/** Formats a word count with a thousands separator. */
export function formatWordCount(count: number): string {
  return count.toLocaleString('zh-CN');
}

/** Human-readable relative time in Chinese. */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 10) return '刚刚';
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(then).toLocaleDateString('zh-CN');
}

/** Formats a clock time for the chat transcript. */
export function formatClock(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/** Truncates text to `max` characters with an ellipsis. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Percentage clamped to 0..100 with one decimal. */
export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((part / total) * 1000) / 10);
}
