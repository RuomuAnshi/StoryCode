import { describe, expect, it } from 'vitest';
import { MemoryFsAdapter, ProjectStore } from '@storycode/storage';
async function createTestProject() {
  return {
    store: await ProjectStore.create(new MemoryFsAdapter(), {
      root: '/tmp/relationship-test',
      name: '示例项目',
    }),
  };
}
import { loadRelationshipGraph } from './relationship-graph';

describe('relationship graph source loading', () => {
  it('uses character names, preserves direction and treats AI suggestions as unconfirmed', async () => {
    const p = await createTestProject();
    await p.store.writeFile(
      'characters/one.md',
      '---\nid: character-one\nname: 示例甲\nrole: supporting\n---\n',
    );
    await p.store.writeFile(
      'characters/two.md',
      '---\nid: character-two\nname: 示例乙\nrole: supporting\n---\n',
    );
    await p.store.writeFile(
      'plot/relationships/one.md',
      '---\nid: relationship-one\nsourceCharacterId: character-two\ntargetCharacterId: character-one\ntype: friendship\nstatus: confirmed\nfactStatus: ai_proposed\n---\n正文不改动',
    );
    const graph = await loadRelationshipGraph(p.store);
    expect(graph.nodes.map((node) => node.name).sort()).toEqual(['示例乙', '示例甲'].sort());
    expect(graph.edges[0]).toMatchObject({
      sourceCharacterId: 'character-two',
      targetCharacterId: 'character-one',
      displayStatus: 'proposed',
    });
    expect(await p.store.readFile('plot/relationships/one.md')).toContain('正文不改动');
  });
  it('shows missing characters and invalid files as warnings rather than inventing names', async () => {
    const p = await createTestProject();
    await p.store.writeFile(
      'plot/relationships/one.md',
      '---\nid: relationship-one\nsourceCharacterId: character-one\ntargetCharacterId: character-missing\ntype: rivalry\nstatus: confirmed\n---\n',
    );
    await p.store.writeFile('plot/relationships/broken.md', '---\nid: [\n---\n');
    const graph = await loadRelationshipGraph(p.store);
    expect(graph.nodes.every((node) => node.missing)).toBe(true);
    expect(graph.warnings.length).toBeGreaterThan(0);
    expect(graph.edges[0]!.displayStatus).toBe('confirmed');
  });
});
