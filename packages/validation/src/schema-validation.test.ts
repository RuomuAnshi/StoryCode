import { describe, expect, it } from 'vitest';
import {
  CharacterCardSchema,
  WorldSettingSchema,
  CharacterRelationshipSchema,
  FactStatusSchema,
  StoryFactSchema,
  ChangeProposalSchema,
} from '@storycode/core';

describe('CharacterCardSchema', () => {
  it('accepts a minimal card and fills optional sections', () => {
    const card = CharacterCardSchema.parse({
      id: 'character-001',
      name: '示例主角',
      role: 'protagonist',
    });
    expect(card.aliases).toEqual([]);
    expect(card.personality.traits).toEqual([]);
    expect(card.status).toBe('draft');
    expect(card.factIds).toEqual([]);
  });

  it('accepts a fully specified card', () => {
    const card = CharacterCardSchema.parse({
      id: 'character-002',
      name: '椎名周宁',
      role: 'supporting',
      basics: { age: 15, identity: '白塔学院四年级生', affiliation: '格兰芬多' },
      personality: {
        traits: ['冷淡', '聪明'],
        flaws: ['不擅长表达'],
        fears: ['被抛弃'],
      },
      narrative: { goals: ['守护秘密'], internalConflict: '想靠近又害怕失去' },
      status: 'confirmed',
    });
    expect(card.personality.traits).toHaveLength(2);
    expect(card.status).toBe('confirmed');
  });

  it('rejects a card without a name', () => {
    expect(() => CharacterCardSchema.parse({ id: 'character-003', role: 'other' })).toThrow();
  });

  it('rejects an unknown role', () => {
    expect(() =>
      CharacterCardSchema.parse({ id: 'character-004', name: '测试', role: 'sidekick' }),
    ).toThrow();
  });

  it('rejects an invalid status', () => {
    expect(() =>
      CharacterCardSchema.parse({ id: 'character-005', name: '测试', status: 'archived' }),
    ).toThrow();
  });
});

describe('WorldSettingSchema', () => {
  it('accepts a minimal world and defaults nested collections', () => {
    const world = WorldSettingSchema.parse({
      id: 'world-001',
      title: '白塔学院',
      genre: ['奇幻'],
      themes: ['成长'],
      tone: ['悬疑'],
    });
    expect(world.institutions).toEqual([]);
    expect(world.rules).toEqual([]);
    expect(world.history).toEqual([]);
    expect(world.status).toBe('draft');
  });

  it('validates nested entities and rules', () => {
    const world = WorldSettingSchema.parse({
      id: 'world-001',
      title: '白塔学院',
      genre: ['奇幻'],
      themes: [],
      tone: [],
      rules: [{ id: 'rule-001', description: '未成年巫师不得在麻瓜面前施法', exceptions: [] }],
      factions: [{ id: 'entity-001', name: '格兰芬多', description: '勇气学院' }],
    });
    expect(world.rules[0]?.description).toContain('未成年巫师');
    expect(world.factions[0]?.name).toBe('格兰芬多');
  });

  it('rejects a rule without a description', () => {
    expect(() =>
      WorldSettingSchema.parse({
        id: 'world-001',
        title: 'x',
        genre: [],
        themes: [],
        tone: [],
        rules: [{ id: 'rule-001' }],
      }),
    ).toThrow();
  });
});

describe('CharacterRelationshipSchema', () => {
  it('accepts an asymmetric relationship', () => {
    const rel = CharacterRelationshipSchema.parse({
      id: 'relationship-001',
      sourceCharacterId: 'character-001',
      targetCharacterId: 'character-002',
      type: 'rivalry',
      description: '林岚把周宁当作朋友，周宁把林岚当作竞争者。',
      sourcePerspective: '朋友',
      targetPerspective: '竞争者',
    });
    expect(rel.sourcePerspective).toBe('朋友');
    expect(rel.targetPerspective).toBe('竞争者');
    expect(rel.status).toBe('draft');
  });

  it('rejects an unknown relationship type', () => {
    expect(() =>
      CharacterRelationshipSchema.parse({
        id: 'relationship-002',
        sourceCharacterId: 'a',
        targetCharacterId: 'b',
        type: 'enemies',
        description: 'x',
      }),
    ).toThrow();
  });
});

describe('StoryFactSchema', () => {
  it('accepts every documented fact status', () => {
    for (const status of [
      'user_confirmed',
      'source_confirmed',
      'ai_proposed',
      'inferred',
      'rejected',
      'superseded',
    ] as const) {
      expect(FactStatusSchema.parse(status)).toBe(status);
    }
  });

  it('requires source references and timestamps', () => {
    const fact = StoryFactSchema.parse({
      id: 'fact-001',
      subjectId: 'character-001',
      predicate: 'age',
      value: '15',
      status: 'user_confirmed',
      sourceRefs: [{ filePath: 'characters/character-001.md' }],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(fact.sourceRefs[0]?.filePath).toBe('characters/character-001.md');
  });

  it('rejects an unknown fact status so AI output cannot invent one', () => {
    expect(() =>
      StoryFactSchema.parse({
        id: 'fact-002',
        subjectId: 'character-001',
        predicate: 'age',
        value: '15',
        status: 'definitely_true',
        sourceRefs: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    ).toThrow();
  });
});

describe('ChangeProposalSchema', () => {
  const base = {
    id: 'proposal-001',
    title: '新建第一章',
    rationale: '用户要求创建第一章',
    createdAt: '2024-01-01T00:00:00.000Z',
    status: 'pending' as const,
    requiresExplicitConfirmation: false,
  };

  it('accepts a proposal with one create change', () => {
    const proposal = ChangeProposalSchema.parse({
      ...base,
      changes: [
        {
          id: 'change-001',
          operation: 'create',
          filePath: 'chapters/001.md',
          baseContentHash: null,
          nextContent: '# 第一章\n',
          previousContent: null,
          summary: '新建章节',
          kind: 'chapter',
        },
      ],
    });
    expect(proposal.changes).toHaveLength(1);
    expect(proposal.decisions).toEqual({});
  });

  it('rejects an empty change set', () => {
    expect(() => ChangeProposalSchema.parse({ ...base, changes: [] })).toThrow();
  });

  it('rejects a delete that still carries content', () => {
    expect(() =>
      ChangeProposalSchema.parse({
        ...base,
        changes: [
          {
            id: 'change-002',
            operation: 'delete',
            filePath: 'chapters/001.md',
            baseContentHash: 'abc',
            nextContent: 'should be empty',
            previousContent: 'old',
            summary: '删除章节',
            kind: 'chapter',
          },
        ],
      }),
    ).toThrow();
  });

  it('rejects an unknown operation', () => {
    expect(() =>
      ChangeProposalSchema.parse({
        ...base,
        changes: [
          {
            id: 'change-003',
            operation: 'rename',
            filePath: 'chapters/001.md',
            baseContentHash: null,
            nextContent: '',
            previousContent: null,
            summary: 'x',
            kind: 'chapter',
          },
        ],
      }),
    ).toThrow();
  });
});
