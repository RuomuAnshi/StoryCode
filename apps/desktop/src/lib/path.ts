/**
 * Minimal POSIX/Windows path helpers.
 *
 * The renderer cannot import `node:path` (it runs in a browser context inside
 * the Tauri webview), so the handful of operations the app needs live here.
 */

/** Detects the separator used by a path. */
export function separatorFor(path: string): '/' | '\\' {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export const sep = '/';

/** Returns the last path segment. */
export function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/** Returns the directory portion of a path. */
export function dirname(path: string): string {
  const normalized = path.replace(/[/\\]+$/, '');
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (index <= 0) return index === 0 ? normalized.slice(0, 1) : '.';
  return normalized.slice(0, index);
}

/** Returns the extension including the dot, lowercased. */
export function extname(path: string): string {
  const base = basename(path);
  const index = base.lastIndexOf('.');
  return index <= 0 ? '' : base.slice(index).toLowerCase();
}

/** Resolves `to` against `from`, collapsing `.` and `..`. */
export function relative(from: string, to: string): string {
  const fromParts = splitPath(from);
  const toParts = splitPath(to);

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }
  const up = Array.from({ length: fromParts.length - common }, () => '..');
  const down = toParts.slice(common);
  const parts = [...up, ...down];
  return parts.length === 0 ? '' : parts.join('/');
}

function splitPath(path: string): string[] {
  const normalized = path.replace(/\\/g, '/');
  const isAbsolute = normalized.startsWith('/');
  const parts = normalized.split('/').filter((part) => part.length > 0 && part !== '.');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else if (!isAbsolute) out.push('..');
    } else {
      out.push(part);
    }
  }
  return isAbsolute ? ['', ...out] : out;
}

/** True when the path is absolute on either platform. */
export function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
}

/** Joins segments with a forward slash. */
export function join(...segments: string[]): string {
  return segments
    .filter((segment) => segment.length > 0)
    .join('/')
    .replace(/\/{2,}/g, '/');
}
