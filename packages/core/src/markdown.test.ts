import { describe, expect, it } from 'vitest';
import {
  parseMarkdown,
  serializeMarkdown,
  replaceFrontmatter,
  extractFirstHeading,
} from './markdown.js';
import {
  parseChapterDocument,
  serializeChapterDocument,
  parseCharacterDocument,
} from './documents.js';

const SAMPLE = `---
id: chapter-001
type: chapter
title: 归来
order: 1
status: draft
---

# 第一章 归来

示例主角推开大门。

> 引用块
> 第二行

- 列表项一
- 列表项二

\`\`\`ts
const x = 1;
\`\`\`
`;

describe('parseMarkdown', () => {
  it('extracts YAML frontmatter and keeps the body verbatim', () => {
    const parsed = parseMarkdown(SAMPLE);
    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.frontmatter.title).toBe('归来');
    expect(parsed.frontmatter.order).toBe(1);
    expect(parsed.body.startsWith('# 第一章 归来')).toBe(true);
  });

  it('treats a file without frontmatter as pure body', () => {
    const parsed = parseMarkdown('# 只有正文\n\n内容。');
    expect(parsed.hasFrontmatter).toBe(false);
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe('# 只有正文\n\n内容。');
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseMarkdown('\uFEFF# 标题').body).toBe('# 标题');
  });

  it('rejects non-mapping frontmatter', () => {
    expect(() => parseMarkdown('---\n- a\n- b\n---\nbody')).toThrow();
  });

  it('rejects malformed YAML rather than silently dropping metadata', () => {
    expect(() => parseMarkdown('---\ntitle: [unclosed\n---\nbody')).toThrow();
  });
});

describe('serializeMarkdown', () => {
  it('round-trips frontmatter and body without losing content', () => {
    const parsed = parseMarkdown(SAMPLE);
    const output = serializeMarkdown(parsed.frontmatter, parsed.body);
    const reparsed = parseMarkdown(output);
    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.body).toBe(parsed.body);
  });

  it('is byte-stable across repeated round trips', () => {
    const parsed = parseMarkdown(SAMPLE);
    const once = serializeMarkdown(parsed.frontmatter, parsed.body);
    const twice = serializeMarkdown(parseMarkdown(once).frontmatter, parseMarkdown(once).body);
    expect(twice).toBe(once);
  });

  it('preserves Chinese prose and paragraph breaks exactly', () => {
    const body = '# 标题\n\n第一段。\n\n第二段。\n';
    const output = serializeMarkdown({ id: 'x' }, body);
    expect(parseMarkdown(output).body).toBe(body);
  });

  it('keeps the body untouched when only frontmatter changes', () => {
    const updated = replaceFrontmatter(SAMPLE, (current) => ({ ...current, status: 'confirmed' }));
    expect(parseMarkdown(updated).frontmatter.status).toBe('confirmed');
    expect(parseMarkdown(updated).body).toBe(parseMarkdown(SAMPLE).body);
  });
});

describe('extractFirstHeading', () => {
  it('returns the first ATX heading', () => {
    expect(extractFirstHeading('\n\n## 第二章 秘密\n\n正文')).toBe('第二章 秘密');
  });

  it('returns null when there is no heading', () => {
    expect(extractFirstHeading('只有正文，没有标题。')).toBeNull();
  });
});

describe('chapter documents', () => {
  it('parses a chapter and re-serializes it losslessly', () => {
    const doc = parseChapterDocument('chapters/001.md', SAMPLE, 1);
    expect(doc.meta.title).toBe('归来');
    expect(doc.meta.order).toBe(1);
    const output = serializeChapterDocument(doc.meta, doc.body);
    const again = parseChapterDocument('chapters/001.md', output, 1);
    expect(again.meta).toEqual(doc.meta);
    expect(again.body).toBe(doc.body);
  });

  it('repairs missing frontmatter from the heading and path order', () => {
    const doc = parseChapterDocument('chapters/007.md', '# 第七章 雪夜\n\n正文。\n', 7);
    expect(doc.meta.title).toBe('第七章 雪夜');
    expect(doc.meta.order).toBe(7);
    expect(doc.meta.id.startsWith('chapter-')).toBe(true);
  });

  it('keeps a stable entity id across re-parses', () => {
    const first = parseChapterDocument('chapters/001.md', SAMPLE, 1);
    const second = parseChapterDocument('chapters/001.md', SAMPLE, 1);
    expect(second.meta.id).toBe(first.meta.id);
  });

  it('keeps the same id when the file is renamed', () => {
    const renamed = parseChapterDocument('chapters/renamed.md', SAMPLE, 1);
    expect(renamed.meta.id).toBe('chapter-001');
  });
});

describe('character documents', () => {
  it('parses a character card from frontmatter', () => {
    const source = `---
id: character-001
type: character
name: 示例主角
role: protagonist
status: confirmed
---

# 示例主角

## 人物背景

白塔学院四年级学生。
`;
    const doc = parseCharacterDocument('characters/character-001.md', source);
    expect(doc.card.id).toBe('character-001');
    expect(doc.card.name).toBe('示例主角');
    expect(doc.card.role).toBe('protagonist');
    expect(doc.card.status).toBe('confirmed');
  });
});
