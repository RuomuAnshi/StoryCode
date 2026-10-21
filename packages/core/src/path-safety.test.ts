import { describe, expect, it } from 'vitest';
import {
  assertSafeName,
  isPathInside,
  normalizeRelativePath,
  joinProjectPath,
  PathTraversalError,
} from './path-safety.js';

describe('normalizeRelativePath', () => {
  it('accepts ordinary project-relative paths', () => {
    expect(normalizeRelativePath('chapters/001.md')).toBe('chapters/001.md');
    expect(normalizeRelativePath('characters/character-001.md')).toBe(
      'characters/character-001.md',
    );
  });

  it('normalizes redundant separators and dot segments', () => {
    expect(normalizeRelativePath('./chapters//001.md')).toBe('chapters/001.md');
    expect(normalizeRelativePath('chapters/./001.md')).toBe('chapters/001.md');
  });

  it('rejects parent traversal', () => {
    expect(() => normalizeRelativePath('../etc/passwd')).toThrow(PathTraversalError);
    expect(() => normalizeRelativePath('chapters/../../secret')).toThrow(PathTraversalError);
  });

  it('rejects absolute paths', () => {
    expect(() => normalizeRelativePath('/etc/passwd')).toThrow(PathTraversalError);
  });

  it('rejects empty paths', () => {
    expect(() => normalizeRelativePath('')).toThrow();
    expect(() => normalizeRelativePath('   ')).toThrow();
  });

  it('rejects NUL bytes and drive-letter style prefixes', () => {
    expect(() => normalizeRelativePath('chapters/\0evil.md')).toThrow();
    expect(() => normalizeRelativePath('C:/Windows/system32')).toThrow(PathTraversalError);
  });

  it('rejects backslash traversal that would escape on Windows', () => {
    expect(() => normalizeRelativePath('..\\..\\Windows\\system32')).toThrow(PathTraversalError);
  });
});

describe('joinProjectPath', () => {
  it('joins a safe relative path onto the root', () => {
    expect(joinProjectPath('/tmp/novel', 'chapters/001.md')).toBe('/tmp/novel/chapters/001.md');
  });

  it('refuses to join an escaping path', () => {
    expect(() => joinProjectPath('/tmp/novel', '../other/secret.md')).toThrow(PathTraversalError);
  });

  it('refuses to join an absolute path', () => {
    expect(() => joinProjectPath('/tmp/novel', '/etc/passwd')).toThrow(PathTraversalError);
  });
});

describe('assertSafeName', () => {
  it('accepts ordinary Chinese and English names', () => {
    expect(assertSafeName('示例小说')).toBe('示例小说');
    expect(assertSafeName('chapter-001')).toBe('chapter-001');
  });

  it('rejects separator, reserved and trailing characters', () => {
    expect(() => assertSafeName('a/b')).toThrow(PathTraversalError);
    expect(() => assertSafeName('con')).toThrow(PathTraversalError);
    expect(() => assertSafeName('name.')).toThrow(PathTraversalError);
    // Surrounding whitespace is trimmed rather than rejected.
    expect(assertSafeName('  name  ')).toBe('name');
  });
});

describe('isPathInside', () => {
  it('recognises nested and identical paths', () => {
    expect(isPathInside('/tmp/novel', '/tmp/novel/chapters/001.md')).toBe(true);
    expect(isPathInside('/tmp/novel', '/tmp/novel')).toBe(true);
  });

  it('rejects siblings and parents', () => {
    expect(isPathInside('/tmp/novel', '/tmp/other/001.md')).toBe(false);
    expect(isPathInside('/tmp/novel', '/tmp')).toBe(false);
    expect(isPathInside('/tmp/novel', '/tmp/novel-2/001.md')).toBe(false);
  });
});
