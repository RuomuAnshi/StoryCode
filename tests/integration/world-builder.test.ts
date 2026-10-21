import { describe, expect, it } from 'vitest';
import { AgentSession, MockProvider, JsonToolClient, type AgentRunRequest } from '@storycode/agent';
import { parseMarkdown, WorldSettingSchema } from '@storycode/core';
import { ProjectStore } from '@storycode/storage';
import { createTestProject } from '../fixtures/test-project';

const directions = {
  mode: 'original',
  characterIds: ['character-001', 'character-002'],
  candidates: [
    {
      id: 'world-campus',
      title: '封闭校园',
      genre: ['校园悬疑'],
      era: '当代',
      coreConflict: '失踪事件与校园封锁',
      premise: '两位室友追查消失的同学。',
      characterFit: '外向主动调查，聪明室友辨析证据。',
    },
    {
      id: 'world-future',
      title: '记忆城市',
      genre: ['科幻悬疑'],
      era: '近未来',
      coreConflict: '记忆交易与身份剥夺',
      premise: '室友的记忆被出售。',
      characterFit: '害怕孤独与情感疏离成为记忆交易的代价。',
    },
    {
      id: 'world-fantasy',
      title: '契约学园',
      genre: ['奇幻'],
      era: '架空时代',
      coreConflict: '契约制度与自由选择',
      premise: '新生被迫签订命运契约。',
      characterFit: '逞强与聪明分别推动冒险和解约。',
    },
  ],
};
const setting = {
  id: 'world-001',
  title: '封闭校园',
  genre: ['校园悬疑'],
  era: '当代',
  themes: ['信任'],
  tone: ['克制', '悬疑'],
  institutions: [{ id: 'institution-school', name: '学校管理处', description: '控制校门与通报' }],
  rules: [{ id: 'rule-curfew', description: '晚间校园封锁' }],
  socialConflicts: ['秩序与真相'],
  history: [
    {
      id: 'history-missing',
      title: '封校前夜',
      description: '失踪事件发生',
      relatedEntities: ['institution-school'],
    },
  ],
};
async function projectFixture() {
  const p = await createTestProject();
  for (const [id, name] of [
    ['character-001', '林岚'],
    ['character-002', '周宁'],
  ])
    await p.store.writeFile(
      `characters/${id}.md`,
      `---\nid: ${id}\nname: ${name}\nrole: supporting\nstatus: confirmed\n---\n\n# ${name}\n`,
    );
  await p.indexer.rebuild();
  return p;
}
async function run(
  p: Awaited<ReturnType<typeof projectFixture>>,
  name: string,
  args: Record<string, unknown>,
  request: Partial<AgentRunRequest> = {},
) {
  const session = new AgentSession({
    client: new MockProvider([
      { toolCalls: [{ name, arguments: args }] },
      { text: '等待作者审核。' },
    ]),
    project: p.store,
    indexer: p.indexer,
    proposals: p.proposals,
    projectName: '测试',
    config: {},
  });
  const gen = session.run({
    mode: 'agent',
    input: '根据这两个人物提出三个原创世界观方向',
    ...request,
  });
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  return next.value;
}

describe('world directions and author selection', () => {
  it('offers three candidate directions without writing world files or creating a canonical proposal', async () => {
    const p = await projectFixture();
    const result = await run(p, 'propose_world_directions', directions);
    expect(result.worldDirections?.candidates).toHaveLength(3);
    expect(result.proposal).toBeNull();
    expect(await p.store.exists('world/overview.md')).toBe(false);
  });
  it('requires a UI selection before structured world refinement', async () => {
    const p = await projectFixture();
    const result = await run(p, 'propose_world_setting', { setting });
    expect(result.proposal).toBeNull();
    expect(result.toolCalls[0]?.status).toBe('failed');
  });
  it('refines only the chosen direction, then safely commits and reopens its Markdown', async () => {
    const p = await projectFixture();
    const first = await run(p, 'propose_world_directions', directions);
    const result = await run(
      p,
      'propose_world_setting',
      { setting },
      { worldSelection: { directions: first.worldDirections!, candidateId: 'world-campus' } },
    );
    expect(result.proposal?.changes).toHaveLength(1);
    const change = result.proposal!.changes[0]!;
    const fm = parseMarkdown(change.nextContent).frontmatter;
    expect(WorldSettingSchema.parse(fm).status).toBe('draft');
    expect(fm.selectedDirectionId).toBe('world-campus');
    expect(change.nextContent).not.toContain('记忆交易');
    expect(change.nextContent).not.toContain('&a1');
    expect(await p.store.exists('world/overview.md')).toBe(false);
    await p.proposals.commit(result.proposal!, { acceptAll: true });
    expect(
      WorldSettingSchema.parse(
        parseMarkdown(await (await ProjectStore.open(p.fs, p.root)).readFile('world/overview.md'))
          .frontmatter,
      ).title,
    ).toBe('封闭校园');
  });
  it('rejects unknown selections and changes that mix the era or genre of another direction', async () => {
    const p = await projectFixture();
    const first = await run(p, 'propose_world_directions', directions);
    expect(
      (
        await run(
          p,
          'propose_world_setting',
          { setting },
          { worldSelection: { directions: first.worldDirections!, candidateId: 'missing' } },
        )
      ).proposal,
    ).toBeNull();
    expect(
      (
        await run(
          p,
          'propose_world_setting',
          { setting: { ...setting, era: '近未来' } },
          { worldSelection: { directions: first.worldDirections!, candidateId: 'world-campus' } },
        )
      ).proposal,
    ).toBeNull();
  });
  it('invalidates directions when their source character files change', async () => {
    const p = await projectFixture();
    const first = await run(p, 'propose_world_directions', directions);
    await p.store.writeFile(
      'characters/character-001.md',
      (await p.store.readFile('characters/character-001.md')) + '\n外部改动\n',
    );
    const result = await run(
      p,
      'propose_world_setting',
      { setting },
      { worldSelection: { directions: first.worldDirections!, candidateId: 'world-campus' } },
    );
    expect(result.proposal).toBeNull();
  });
  it('rejects a commit if a referenced character changed during review', async () => {
    const p = await projectFixture();
    const first = await run(p, 'propose_world_directions', directions);
    const result = await run(
      p,
      'propose_world_setting',
      { setting },
      { worldSelection: { directions: first.worldDirections!, candidateId: 'world-campus' } },
    );
    await p.store.writeFile(
      'characters/character-001.md',
      (await p.store.readFile('characters/character-001.md')) + '\n审核期间外部修改\n',
    );
    await expect(p.proposals.commit(result.proposal!, { acceptAll: true })).rejects.toThrow();
    expect(await p.store.exists('world/overview.md')).toBe(false);
  });
  it('rejects cross-project choices before calling the model', async () => {
    const p = await projectFixture();
    const first = await run(p, 'propose_world_directions', directions);
    const forged = structuredClone(first.worldDirections!);
    forged.projectRoot = '/another-project';
    const result = await run(
      p,
      'propose_world_setting',
      { setting },
      { worldSelection: { directions: forged, candidateId: 'world-campus' } },
    );
    expect(result.status).toBe('failed');
    expect(result.toolCalls).toHaveLength(0);
  });
  it('returns candidates through the JSON adapter without letting the model choose', async () => {
    const p = await projectFixture();
    const mock = new MockProvider([
      { text: JSON.stringify({ tool: 'propose_world_directions', arguments: directions }) },
    ]);
    const session = new AgentSession({
      client: new JsonToolClient(mock),
      project: p.store,
      indexer: p.indexer,
      proposals: p.proposals,
      projectName: '测试',
      config: {},
    });
    const gen = session.run({ mode: 'agent', input: '构思三个世界观方向' });
    let next = await gen.next();
    while (!next.done) next = await gen.next();
    expect(next.value.worldDirections?.candidates).toHaveLength(3);
    expect(next.value.proposal).toBeNull();
    expect(mock.calls).toHaveLength(1);
  });
  it('refuses to overwrite an existing worldview or accept ambiguous duplicate organizations', async () => {
    const p = await projectFixture();
    const first = await run(p, 'propose_world_directions', directions);
    const selection = { directions: first.worldDirections!, candidateId: 'world-campus' };
    const repeated = {
      ...setting,
      institutions: [
        ...setting.institutions,
        { id: 'institution-other', name: '学校管理处', description: '重复名称' },
      ],
    };
    expect(
      (await run(p, 'propose_world_setting', { setting: repeated }, { worldSelection: selection }))
        .proposal,
    ).toBeNull();
    await p.store.writeFile('world/overview.md', '# 已有且必须保留的世界观');
    expect(
      (await run(p, 'propose_world_setting', { setting }, { worldSelection: selection })).proposal,
    ).toBeNull();
    expect(await p.store.readFile('world/overview.md')).toBe('# 已有且必须保留的世界观');
  });
  it('does not let the model promote generated world details into confirmed facts', async () => {
    const p = await projectFixture();
    const first = await run(p, 'propose_world_directions', directions);
    const result = await run(
      p,
      'propose_world_setting',
      { setting: { ...setting, confirmedFacts: ['伪造的确定事实'] } },
      { worldSelection: { directions: first.worldDirections!, candidateId: 'world-campus' } },
    );
    expect(result.proposal).toBeNull();
  });
  it('rejects repeated candidates, missing character IDs and generic file-tool bypasses', async () => {
    const p = await projectFixture();
    expect(
      (
        await run(p, 'propose_world_directions', {
          ...directions,
          candidates: [
            directions.candidates[0],
            directions.candidates[0],
            directions.candidates[0],
          ],
        })
      ).worldDirections,
    ).toBeNull();
    expect(
      (
        await run(p, 'propose_world_directions', {
          ...directions,
          characterIds: ['character-missing'],
        })
      ).worldDirections,
    ).toBeNull();
    expect(
      (await run(p, 'propose_create_file', { path: 'world/overview.md', content: '# 擅自确定' }))
        .proposal,
    ).toBeNull();
  });
  it('supports a specified existing universe only with literal evidence from the author', async () => {
    const p = await projectFixture();
    const args = {
      ...directions,
      mode: 'existing',
      existingWorld: '示例原作',
      sourceQuote: '采用示例原作世界观',
      candidates: [directions.candidates[0]],
    };
    const result = await run(p, 'propose_world_directions', args, { input: '采用示例原作世界观' });
    expect(result.worldDirections?.mode).toBe('existing');
    expect((await run(p, 'propose_world_directions', args)).worldDirections).toBeNull();
  });
});

describe('safe world section updates', () => {
  async function seeded() {
    const p = await projectFixture();
    const first = await run(p, 'propose_world_directions', directions);
    const refined = await run(
      p,
      'propose_world_setting',
      { setting },
      {
        worldSelection: { directions: first.worldDirections!, candidateId: 'world-campus' },
      },
    );
    await p.proposals.commit(refined.proposal!, { acceptAll: true });
    return p;
  }
  it('requires nonempty themes in new world designs', async () => {
    const p = await projectFixture();
    const first = await run(p, 'propose_world_directions', directions);
    for (const themes of [undefined, [], ['   ']]) {
      const result = await run(
        p,
        'propose_world_setting',
        { setting: { ...setting, themes } },
        {
          worldSelection: { directions: first.worldDirections!, candidateId: 'world-campus' },
        },
      );
      expect(result.proposal).toBeNull();
    }
  });
  it('queues a narrow update, preserves author notes and history, and checks versions', async () => {
    const p = await seeded();
    const before = await p.store.readFile('world/overview.md');
    await p.store.writeFile('world/overview.md', before + '\n## 作者补充\n\n保留这一段。\n');
    const result = await run(p, 'propose_world_update', {
      field: 'themes',
      values: ['自由与责任'],
    });
    expect(result.proposal).not.toBeNull();
    expect(await p.store.readFile('world/overview.md')).toContain('- 信任');
    const change = result.proposal!.changes[0]!;
    expect(change.nextContent).toContain('保留这一段。');
    expect(parseMarkdown(change.nextContent).frontmatter.themes).toEqual(['自由与责任']);
    expect(parseMarkdown(change.nextContent).frontmatter.worldRevisionHistory).toEqual([
      expect.objectContaining({
        field: 'themes',
        previous: ['信任'],
        next: ['自由与责任'],
        status: 'ai_proposed',
      }),
    ]);
    await p.store.writeFile('world/overview.md', before + '\n作者新修改');
    await expect(p.proposals.commit(result.proposal!, { acceptAll: true })).rejects.toThrow();
  });
  it('commits reviewed updates and appends a previously absent section', async () => {
    const p = await seeded();
    const result = await run(p, 'propose_world_update', {
      field: 'unresolvedQuestions',
      values: ['谁封锁了校门？'],
    });
    await p.proposals.commit(result.proposal!, { acceptAll: true });
    const raw = await p.store.readFile('world/overview.md');
    expect(raw).toContain('## 待确认问题\n\n- 谁封锁了校门？');
    expect(parseMarkdown(raw).frontmatter.unresolvedQuestions).toEqual(['谁封锁了校门？']);
    expect(parseMarkdown(raw).frontmatter.factStatus).toBe('ai_proposed');
    expect(raw).toContain('控制校门与通报');
  });
  it('refuses manual section mismatches, confirmed worlds and protected fields', async () => {
    const p = await seeded();
    const before = await p.store.readFile('world/overview.md');
    await p.store.writeFile('world/overview.md', before.replace('- 信任', '- 作者手写主题'));
    expect(
      (await run(p, 'propose_world_update', { field: 'themes', values: ['自由'] })).proposal,
    ).toBeNull();
    await p.store.writeFile(
      'world/overview.md',
      before.replace('status: draft', 'status: confirmed'),
    );
    expect(
      (await run(p, 'propose_world_update', { field: 'tone', values: ['明快'] })).proposal,
    ).toBeNull();
    expect(
      (await run(p, 'propose_world_update', { field: 'id', values: ['world-forged'] })).proposal,
    ).toBeNull();
  });
  it('updates organizations and rules without losing other sections, and rejects dangling history references', async () => {
    const p = await seeded();
    const renamed = await run(p, 'propose_world_update', {
      field: 'institutions',
      values: [{ id: 'institution-school', name: '学生管理处', description: '控制校门与通报' }],
    });
    expect(renamed.proposal).not.toBeNull();
    expect(renamed.proposal!.changes[0]!.nextContent).toContain('- 学生管理处：控制校门与通报');
    await p.proposals.commit(renamed.proposal!, { acceptAll: true });
    expect(
      (await run(p, 'propose_world_update', { field: 'institutions', values: [] })).proposal,
    ).toBeNull();
    const rules = await run(p, 'propose_world_update', {
      field: 'rules',
      values: [{ id: 'rule-curfew', description: '午夜校园封锁', exceptions: ['持通行证者'] }],
    });
    expect(rules.proposal!.changes[0]!.nextContent).toContain('午夜校园封锁；例外：持通行证者');
    expect(rules.proposal!.changes[0]!.nextContent).toContain('学生管理处');
    expect(
      (
        await run(p, 'propose_world_update', {
          field: 'rules',
          values: [{ id: 'rule-curfew', description: '新规则', factIds: ['fact-forged'] }],
        })
      ).proposal,
    ).toBeNull();
  });
});
