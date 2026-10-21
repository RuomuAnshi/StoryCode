import { describe, expect, it } from 'vitest';
import {
  AgentSession,
  MockProvider,
  updateCharacter,
  JsonToolClient,
  findTool,
} from '@storycode/agent';
import { parseMarkdown, characterRetrievalText } from '@storycode/core';
import { ProjectStore } from '@storycode/storage';
import { createTestProject } from '../fixtures/test-project';

const input = '创建林岚，性格外向、喜欢逞强；室友周宁性格冷淡、非常聪明。';
const design = {
  characters: [
    {
      card: {
        id: 'character-anon',
        name: '林岚',
        role: 'protagonist',
        personality: { traits: ['外向'], flaws: ['喜欢逞强'], fears: ['孤独'] },
      },
      sources: [
        { field: 'personality.traits', quote: '性格外向' },
        { field: 'personality.flaws', quote: '喜欢逞强' },
      ],
    },
    {
      card: {
        id: 'character-taki',
        name: '周宁',
        role: 'supporting',
        personality: { traits: ['冷淡'], strengths: ['非常聪明'] },
      },
      sources: [
        { field: 'personality.traits', quote: '性格冷淡' },
        { field: 'personality.strengths', quote: '非常聪明' },
      ],
    },
  ],
  relationships: [
    {
      id: 'relationship-roommate',
      sourceCharacterId: 'character-anon',
      targetCharacterId: 'character-taki',
      type: 'friendship',
      description: '室友关系可能逐步发展为友情',
      sourcePerspective: '想靠近她',
      targetPerspective: '仍保持距离',
    },
  ],
};
async function run(
  project: Awaited<ReturnType<typeof createTestProject>>,
  name: string,
  args: Record<string, unknown>,
  text = input,
  mode: 'agent' | 'ask' = 'agent',
) {
  const client = new MockProvider([
    { toolCalls: [{ name, arguments: args }] },
    { text: '等待审核。' },
  ]);
  const session = new AgentSession({
    client,
    project: project.store,
    proposals: project.proposals,
    indexer: project.indexer,
    projectName: '测试',
    config: {},
  });
  const gen = session.run({ input: text, mode });
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  return next.value;
}

describe('character design proposal workflow', () => {
  it('advertises input optionality instead of requiring every defaulted card field', () => {
    expect(findTool('propose_character_cards')?.parameters).toMatchObject({
      properties: {
        characters: { items: { properties: { card: { required: ['id', 'name', 'role'] } } } },
      },
    });
  });
  it('generates two validated cards, conservative facts and a directed relationship, then commits and reopens', async () => {
    const project = await createTestProject();
    const result = await run(project, 'propose_character_cards', design);
    expect(result.proposal?.changes).toHaveLength(3);
    expect(await project.store.exists('characters/character-anon.md')).toBe(false);
    const card = result.proposal!.changes.find(
      (c) => c.filePath === 'characters/character-anon.md',
    )!;
    const fm = parseMarkdown(card.nextContent).frontmatter;
    expect(fm.status).toBe('draft');
    expect(fm.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ predicate: 'personality.traits', status: 'user_confirmed' }),
        expect.objectContaining({ predicate: 'personality.fears', status: 'ai_proposed' }),
      ]),
    );
    expect(card.nextContent).toContain('AI 建议');
    await project.proposals.commit(result.proposal!, { acceptAll: true });
    const reopened = await ProjectStore.open(project.fs, project.root);
    expect(await reopened.readFile(card.filePath)).toContain('林岚');
    expect(characterRetrievalText(card.nextContent)).not.toContain('孤独');
    expect(characterRetrievalText(card.nextContent)).toContain('外向');
    await project.indexer.rebuild();
    expect(project.indexer.search('外向')).not.toHaveLength(0);
    expect(project.indexer.search('孤独')).toHaveLength(0);
    expect(project.indexer.search('逐步发展为友情')).toHaveLength(0);
    await project.indexer.updateFile(card.filePath);
    expect(project.indexer.search('孤独')).toHaveLength(0);
  });
  it('works through the JSON compatibility adapter without using a paid model', async () => {
    const project = await createTestProject();
    const client = new JsonToolClient(
      new MockProvider([
        { text: JSON.stringify({ tool: 'propose_character_cards', arguments: design }) },
        { text: '人物提案已准备，等待作者审核。' },
      ]),
    );
    const session = new AgentSession({
      client,
      project: project.store,
      proposals: project.proposals,
      indexer: project.indexer,
      projectName: '测试',
      config: {},
    });
    const gen = session.run({ input, mode: 'agent' });
    let next = await gen.next();
    while (!next.done) next = await gen.next();
    expect(next.value.status).toBe('completed');
    expect(next.value.proposal?.changes).toHaveLength(3);
  });
  it('reads directed relationships and labels their draft status', async () => {
    const project = await createTestProject();
    const result = await run(project, 'propose_character_cards', design);
    await project.proposals.commit(result.proposal!, { acceptAll: true });
    const read = await run(
      project,
      'get_relationships',
      { characterId: 'character-taki' },
      '读取周宁的关系',
      'ask',
    );
    expect(read.toolCalls[0]?.error).toBeUndefined();
    expect(read.toolCalls[0]?.status).toBe('done');
    const relation = parseMarkdown(
      await project.store.readFile('plot/relationships/relationship-roommate.md'),
    ).frontmatter;
    expect(relation.status).toBe('draft');
    expect(relation.sourcePerspective).not.toBe(relation.targetPerspective);
  });
  it('recognizes the Chinese role label in a literal author quote', async () => {
    const project = await createTestProject();
    const args = structuredClone(design);
    args.characters[0]!.sources.push({ field: 'role', quote: '林岚是女主角' });
    const result = await run(project, 'propose_character_cards', args, input + '林岚是女主角。');
    expect(result.proposal?.changes).toHaveLength(3);
    const fm = parseMarkdown(result.proposal!.changes[0]!.nextContent).frontmatter;
    expect(fm.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          predicate: 'role',
          status: 'user_confirmed',
          value: 'protagonist',
        }),
      ]),
    );
  });
  it('rejects fabricated source quotes and dangling relationships without queuing any changes', async () => {
    const project = await createTestProject();
    const bad = structuredClone(design);
    bad.characters[0]!.sources[0]!.quote = '用户没有说过';
    const result = await run(project, 'propose_character_cards', bad);
    expect(result.proposal).toBeNull();
    expect(result.toolCalls[0]?.status).toBe('failed');
    bad.characters[0]!.sources[0]!.quote = '性格外向';
    bad.relationships[0]!.targetCharacterId = 'character-missing';
    expect((await run(project, 'propose_character_cards', bad)).proposal).toBeNull();
  });
  it('prevents relation-only partial acceptance from creating dangling references', async () => {
    const project = await createTestProject();
    const result = await run(project, 'propose_character_cards', design);
    const relationship = result.proposal!.changes.find((c) => c.kind === 'plot')!;
    await expect(
      project.proposals.commit(result.proposal!, { decisions: { [relationship.id]: 'accepted' } }),
    ).rejects.toThrow();
  });
  it('changes only the requested leaf, preserves notes and fact history, and keeps IDs stable', async () => {
    const project = await createTestProject();
    const first = await run(project, 'propose_character_cards', design);
    await project.proposals.commit(first.proposal!, { acceptAll: true });
    const path = 'characters/character-taki.md';
    const before = await project.store.readFile(path);
    await project.store.writeFile(path, before + '\n作者手写备注：不要删除。\n');
    const result = await run(
      project,
      'propose_character_update',
      {
        path,
        changes: [{ field: 'personality.traits', value: ['易怒'], quote: '性格易怒' }],
      },
      '让周宁性格易怒。',
    );
    expect(result.proposal?.changes).toHaveLength(1);
    const next = parseMarkdown(result.proposal!.changes[0]!.nextContent);
    expect(next.frontmatter.id).toBe('character-taki');
    expect(next.frontmatter.personality).toMatchObject({
      traits: ['易怒'],
      strengths: ['非常聪明'],
    });
    expect(next.body).toContain('作者手写备注：不要删除。');
    expect(next.frontmatter.facts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ predicate: 'personality.traits', status: 'superseded' }),
      ]),
    );
    await project.proposals.commit(result.proposal!, { acceptAll: true });
  });
  it('does not allow AI to replace confirmed facts without direct evidence in the current request', async () => {
    const project = await createTestProject();
    const first = await run(project, 'propose_character_cards', design);
    await project.proposals.commit(first.proposal!, { acceptAll: true });
    const result = await run(
      project,
      'propose_character_update',
      {
        path: 'characters/character-taki.md',
        changes: [{ field: 'personality.traits', value: ['暴躁'] }],
      },
      '分析这个人物',
    );
    expect(result.proposal).toBeNull();
    expect(result.toolCalls[0]?.status).toBe('failed');
  });
  it('blocks generic file tools from bypassing structured character validation', async () => {
    const project = await createTestProject();
    expect(
      (
        await run(project, 'propose_create_file', {
          path: 'characters/a.md',
          content: '# 未经校验',
        })
      ).proposal,
    ).toBeNull();
  });
  it('binds updates to the version read by the workflow, before proposal creation', async () => {
    const project = await createTestProject();
    const initial = await run(project, 'propose_character_cards', design);
    await project.proposals.commit(initial.proposal!, { acceptAll: true });
    const path = 'characters/character-taki.md';
    const change = await updateCharacter(
      { path, changes: [{ field: 'personality.traits', value: ['易怒'], quote: '易怒' }] },
      { project: project.store, indexer: project.indexer, pending: [], userInput: '让她易怒' },
    );
    await project.store.writeFile(path, (await project.store.readFile(path)) + '\n外部编辑\n');
    await expect(
      project.proposals.create({
        title: '过期更新',
        changes: [{ ...change, expectedBaseContentHash: change.baseContentHash }],
      }),
    ).rejects.toThrow();
  });
  it('refuses to regenerate an author-edited managed section', async () => {
    const project = await createTestProject();
    const initial = await run(project, 'propose_character_cards', design);
    await project.proposals.commit(initial.proposal!, { acceptAll: true });
    const path = 'characters/character-taki.md';
    await project.store.writeFile(
      path,
      (await project.store.readFile(path)).replace('## 性格特点', '## 作者修改的标题'),
    );
    const result = await run(
      project,
      'propose_character_update',
      { path, changes: [{ field: 'personality.traits', value: ['易怒'], quote: '易怒' }] },
      '让她易怒',
    );
    expect(result.proposal).toBeNull();
  });
  it('protects IDs and status from model-supplied patches', async () => {
    const project = await createTestProject();
    const initial = await run(project, 'propose_character_cards', design);
    await project.proposals.commit(initial.proposal!, { acceptAll: true });
    const result = await run(project, 'propose_character_update', {
      path: 'characters/character-taki.md',
      changes: [{ field: 'status', value: 'confirmed' }],
    });
    expect(result.proposal).toBeNull();
  });
  it('excludes character proposal tools in Ask mode', async () => {
    const project = await createTestProject();
    expect(
      (await run(project, 'propose_character_cards', design, input, 'ask')).proposal,
    ).toBeNull();
  });
});
