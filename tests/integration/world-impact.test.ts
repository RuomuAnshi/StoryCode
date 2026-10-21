import { describe, expect, it } from 'vitest';
import { serializeMarkdown } from '@storycode/core';
import { createTestProject } from '../fixtures/test-project';

async function fixture() {
  const p = await createTestProject();
  const before = serializeMarkdown(
    { id: 'world-test', title: '封闭校园', themes: ['信任与背叛'] },
    '# 世界观\n',
  );
  const after = serializeMarkdown(
    { id: 'world-test', title: '封闭校园', themes: ['自由与责任'] },
    '# 世界观\n',
  );
  await p.store.writeFile('world/overview.md', before);
  const propose = () =>
    p.proposals.create({
      title: '更新主题',
      changes: [
        { operation: 'update', filePath: 'world/overview.md', nextContent: after, kind: 'world' },
      ],
    });
  return { ...p, before, propose };
}

describe('world change impact review', () => {
  it('collects explicit and lexical evidence from real files without writing them', async () => {
    const p = await fixture();
    await p.store.writeFile(
      'plot/outline.md',
      '---\nrelatedFiles:\n  - world/overview.md\n---\n\n# 大纲\n',
    );
    await p.store.writeFile('chapters/001.md', '# 第一章\n\n信任与背叛贯穿这段对白。\n');
    const proposal = await p.propose();
    const report = proposal.changes[0]!.worldImpact!;
    expect(report.files.map((f) => f.filePath)).toEqual(['chapters/001.md', 'plot/outline.md']);
    expect(report.files[0]!.evidence[0]).toMatchObject({
      line: 3,
      reason: 'text_match',
      excerpt: '信任与背叛贯穿这段对白。',
    });
    expect(report.files[1]!.evidence[0]!.reason).toBe('explicit_reference');
    expect((await p.proposals.load(proposal.id))!.changes[0]!.worldImpact).toEqual(report);
    await expect(p.proposals.commit(proposal, { acceptAll: true })).rejects.toThrow('影响');
    expect(await p.store.readFile('world/overview.md')).toBe(p.before);
    await p.proposals.commit(proposal, { acceptAll: true, acknowledgeWorldImpact: true });
    expect(await p.store.readFile('chapters/001.md')).toContain('信任与背叛');
  });
  it('requires a new review if evidence changes or a new dependent file appears', async () => {
    const p = await fixture();
    const proposal = await p.propose();
    expect(proposal.changes[0]!.worldImpact!.files).toEqual([]);
    await p.store.writeFile('chapters/002.md', '引用 world/overview.md 的新章节。');
    await expect(
      p.proposals.commit(proposal, { acceptAll: true, acknowledgeWorldImpact: true }),
    ).rejects.toThrow('重新');
    const refreshed = await p.propose();
    await p.store.writeFile('chapters/002.md', '引用 world/overview.md 的新章节，作者又编辑了。');
    await expect(
      p.proposals.commit(refreshed, { acceptAll: true, acknowledgeWorldImpact: true }),
    ).rejects.toThrow('重新');
  });
  it('does not require acknowledging a rejected world change', async () => {
    const p = await fixture();
    await p.store.writeFile('chapters/001.md', '信任与背叛');
    const proposal = await p.proposals.create({
      title: '混合提案',
      changes: [
        {
          operation: 'update',
          filePath: 'world/overview.md',
          nextContent: '# 新设定',
          kind: 'world',
        },
        { operation: 'create', filePath: 'notes/new.md', nextContent: '作者笔记' },
      ],
    });
    await p.proposals.commit(proposal, {
      decisions: { [proposal.changes[0]!.id]: 'rejected', [proposal.changes[1]!.id]: 'accepted' },
    });
    expect(await p.store.readFile('world/overview.md')).toBe(p.before);
  });
});
