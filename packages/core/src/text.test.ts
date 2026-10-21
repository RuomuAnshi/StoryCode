import { describe, expect, it } from 'vitest';
import { countWords, excerpt, stripMarkdown } from './text.js';

describe('countWords', () => {
  it('counts CJK characters and Latin words separately', () => {
    const result = countWords('示例主角回到白塔学院。');
    expect(result.cjkCharacters).toBe(10);
    expect(result.words).toBe(0);
    expect(result.total).toBe(10);
  });

  it('counts mixed Chinese and English text', () => {
    const result = countWords('林岚 uses a wand');
    expect(result.cjkCharacters).toBe(2);
    expect(result.words).toBe(3);
    expect(result.total).toBe(5);
  });

  it('ignores whitespace for the character count', () => {
    const result = countWords('一 二\n三');
    expect(result.characters).toBe(3);
    expect(result.cjkCharacters).toBe(3);
  });

  it('returns zeros for empty input', () => {
    expect(countWords('')).toEqual({ characters: 0, cjkCharacters: 0, words: 0, total: 0 });
  });
});

describe('stripMarkdown', () => {
  it('removes headings, emphasis and link syntax', () => {
    const stripped = stripMarkdown('# 标题\n\n**粗体** 与 [链接](https://example.com)');
    expect(stripped).toBe('标题 粗体 与 链接');
  });

  it('drops fenced code blocks', () => {
    expect(stripMarkdown('前\n```\ncode\n```\n后')).toBe('前 后');
  });
});

describe('excerpt', () => {
  it('truncates to the requested length with an ellipsis', () => {
    const text = '一二三四五六七八九十';
    const snippet = excerpt(text, 4);
    expect(snippet.startsWith('一二三四')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(5);
  });

  it('returns short text unchanged', () => {
    expect(excerpt('短文本', 20)).toBe('短文本');
  });
});
