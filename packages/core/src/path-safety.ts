/**
 * Path containment rules.
 *
 * Every path that reaches the filesystem passes through here first. The goal is
 * to make directory traversal and symlink escapes impossible regardless of what
 * the model (or a malicious project file) asks for.
 *
 * This module is intentionally free of Node built-ins so it can run in the
 * browser, in the Tauri frontend, and in unit tests alike.
 */

export class PathTraversalError extends Error {
  override readonly name = 'PathTraversalError';
  constructor(
    readonly attemptedPath: string,
    readonly reason: string,
  ) {
    super(`Unsafe path rejected (${reason}): ${attemptedPath}`);
  }
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
/** Removes ASCII control characters (including NUL). */
function stripControlChars(input: string): string {
  let out = '';
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0x1f && code !== 0x7f) out += char;
  }
  return out;
}

/**
 * True when the string contains ASCII control characters (including NUL).
 * Implemented by code point so the source file holds no literal control range.
 */
function hasControlChars(input: string): boolean {
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Characters that are illegal in Windows filenames and hostile elsewhere. */
const ILLEGAL_NAME_CHARS = /[<>:"|?*\\/]/;

/**
 * Normalizes a project-relative path to POSIX form.
 * Collapses separators, strips leading `./`, and rejects anything absolute.
 */
export function normalizeRelativePath(input: string): string {
  if (typeof input !== 'string' || input.length === 0) {
    throw new PathTraversalError(String(input), 'empty path');
  }
  if (hasControlChars(input)) {
    throw new PathTraversalError(input, 'control character');
  }
  if (input.trim().length === 0) {
    throw new PathTraversalError(input, 'whitespace-only path');
  }
  // Normalize separators before any inspection.
  const unified = input.replace(/\\/g, '/');
  if (unified.startsWith('/')) {
    throw new PathTraversalError(input, 'absolute path');
  }
  if (/^[a-zA-Z]:/.test(unified)) {
    throw new PathTraversalError(input, 'drive-qualified path');
  }
  if (unified.startsWith('~')) {
    throw new PathTraversalError(input, 'home-relative path');
  }

  const segments: string[] = [];
  for (const rawSegment of unified.split('/')) {
    if (rawSegment === '' || rawSegment === '.') continue;
    if (rawSegment === '..') {
      throw new PathTraversalError(input, 'parent traversal');
    }
    if (rawSegment.includes('\0')) {
      throw new PathTraversalError(input, 'null byte');
    }
    segments.push(rawSegment);
  }
  if (segments.length === 0) {
    throw new PathTraversalError(input, 'resolves to project root');
  }
  return segments.join('/');
}

/**
 * Validates a single file or directory name (no separators).
 * Returns the trimmed name or throws.
 */
export function assertSafeName(input: string): string {
  const name = input.trim();
  if (name.length === 0) {
    throw new PathTraversalError(input, 'empty name');
  }
  if (name === '.' || name === '..') {
    throw new PathTraversalError(input, 'reserved name');
  }
  if (ILLEGAL_NAME_CHARS.test(name)) {
    throw new PathTraversalError(input, 'illegal character');
  }
  if (hasControlChars(name)) {
    throw new PathTraversalError(input, 'control character');
  }
  if (WINDOWS_RESERVED.test(name)) {
    throw new PathTraversalError(input, 'reserved device name');
  }
  // Trailing dots and spaces are silently dropped by Windows.
  if (/[ .]$/.test(name)) {
    throw new PathTraversalError(input, 'trailing dot or space');
  }
  if (name.length > 120) {
    throw new PathTraversalError(input, 'name too long');
  }
  return name;
}

/** True when `child` is `parent` itself or nested beneath it (POSIX semantics). */
export function isPathInside(parent: string, child: string): boolean {
  const base = parent.replace(/\/+$/, '');
  const target = child.replace(/\/+$/, '');
  if (target === base) return true;
  return target.startsWith(`${base}/`);
}

/**
 * Joins already-validated relative segments onto an absolute root and asserts
 * the result stays inside that root.
 */
export function joinProjectPath(root: string, relative: string): string {
  const safeRelative = normalizeRelativePath(relative);
  const base = root.replace(/\/+$/, '');
  const joined = `${base}/${safeRelative}`;
  if (!isPathInside(base, joined)) {
    throw new PathTraversalError(relative, 'escapes project root');
  }
  return joined;
}

/** Converts a display title into a safe filename stem (unicode preserved). */
export function slugifyFileName(input: string, fallback = 'untitled'): string {
  const cleaned = stripControlChars(input.normalize('NFKC'))
    .replace(/[<>:"|?*\\/]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-\s]+/, '')
    .replace(/[.\-\s]+$/, '');
  const truncated = cleaned.slice(0, 80);
  return truncated.length > 0 ? truncated : fallback;
}
