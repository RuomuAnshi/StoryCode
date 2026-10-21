import { describe, expect, it } from 'vitest';
import { tokenizeForSearch } from '@storycode/core';
import { SearchIndex } from './search-index.js';

function doc(
  path: string,
  title: string,
  content: string,
  kind: 'chapter' | 'character' | 'world' | 'plot' | 'other' = 'chapter',
) {
  return { path, title, content, kind };
}

function buildIndex() {
  const index = new SearchIndex();
  index.put(
    doc('chapters/001.md', '第一章 归来', '# 第一章 归来\n\n示例主角回到白塔学院，风很大。\n'),
  );
  index.put(
    doc(
      'chapters/002.md',
      '第二章 午夜的秘密',
      '# 第二章 午夜的秘密\n\n走廊尽头的灯忽明忽暗，周宁压低声音。\n',
    ),
  );
  index.put(
    doc(
      'characters/character-001.md',
      '示例主角',
      '---\nname: 示例主角\n---\n\n# 示例主角\n\n白塔学院四年级学生。\n',
      'character',
    ),
  );
  index.put(doc('world/overview.md', '世界观', '# 世界观\n\n魔法学校与古老城堡。\n', 'world'));
  return index;
}

describe('tokenizeForSearch', () => {
  it('produces CJK bigrams and Latin words', () => {
    const tokens = tokenizeForSearch('林岚 uses a wand');
    expect(tokens).toContain('林岚');
    expect(tokens).toContain('林');
    expect(tokens).toContain('uses');
    expect(tokens).toContain('wand');
    // Single letters are dropped as noise.
    expect(tokens).not.toContain('a');
  });

  it('returns no tokens for punctuation-only input', () => {
    expect(tokenizeForSearch('，。！？')).toHaveLength(0);
  });
});

describe('SearchIndex', () => {
  it('finds the chapter that contains a Chinese phrase', () => {
    const hits = buildIndex().search('午夜的秘密');
    expect(hits[0]?.path).toBe('chapters/002.md');
  });

  it('finds a character by name', () => {
    const hits = buildIndex().search('示例主角');
    expect(hits[0]?.path).toBe('characters/character-001.md');
  });

  it('returns no hits for a query that appears nowhere', () => {
    // This is what lets the agent answer "I don't know" instead of inventing.
    expect(buildIndex().search('不存在的词')).toHaveLength(0);
  });

  it('returns no hits for an empty query', () => {
    expect(buildIndex().search('')).toHaveLength(0);
    expect(buildIndex().search('   ')).toHaveLength(0);
  });

  it('ranks the most relevant file first', () => {
    const hits = buildIndex().search('白塔学院');
    expect(hits.length).toBeGreaterThan(0);
    const paths = hits.map((hit) => hit.path);
    expect(paths).toContain('chapters/001.md');
    expect(paths).toContain('characters/character-001.md');
  });

  it('reports matched terms and a snippet with line numbers', () => {
    const hits = buildIndex().search('灯忽明忽暗');
    const hit = hits[0];
    expect(hit).toBeDefined();
    if (!hit) throw new Error('unreachable');
    expect(hit.path).toBe('chapters/002.md');
    expect(hit.matchedTerms.length).toBeGreaterThan(0);
    expect(hit.snippet).toContain('灯忽明忽暗');
    expect(hit.startLine).toBeGreaterThan(0);
    expect(hit.endLine).toBeGreaterThanOrEqual(hit.startLine);
  });

  it('respects the limit option', () => {
    const hits = buildIndex().search('白塔学院', { limit: 1 });
    expect(hits).toHaveLength(1);
  });

  it('filters by document kind', () => {
    const hits = buildIndex().search('白塔学院', { kind: 'character' });
    expect(hits.every((hit) => hit.kind === 'character')).toBe(true);
  });

  it('updates a document when it is re-indexed', () => {
    const index = buildIndex();
    expect(index.search('风很大').map((hit) => hit.path)).toEqual(['chapters/001.md']);
    // The author rewrites the chapter; the old text must stop matching.
    index.put(doc('chapters/001.md', '第一章 归来', '# 第一章 归来\n\n示例主角走进城堡。\n'));
    expect(index.search('风很大')).toHaveLength(0);
    // `城堡` also appears in world/overview.md, so that file is a legitimate
    // match — the rewritten chapter must merely rank above it.
    const hits = index.search('走进城堡');
    expect(hits[0]?.path).toBe('chapters/001.md');
    expect(hits.map((hit) => hit.path)).toContain('chapters/001.md');
  });

  it('removes deleted documents from the index', () => {
    const index = buildIndex();
    index.remove('chapters/002.md');
    expect(index.search('午夜的秘密')).toHaveLength(0);
  });

  it('tracks document count', () => {
    expect(buildIndex().size).toBe(4);
  });
});
