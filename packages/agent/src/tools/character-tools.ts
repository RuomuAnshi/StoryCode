import { z } from 'zod';
import {
  CharacterDesignSchema,
  CharacterUpdateSchema,
  CharacterRelationshipSchema,
  parseMarkdown,
} from '@storycode/core';
import { designCharacters, updateCharacter } from '../workflows/character-designer.js';
import { defineTool } from './types.js';

export const proposeCharacterCardsTool = defineTool({
  name: 'propose_character_cards',
  description:
    '根据作者自然语言创建一到六份结构化角色卡及有方向的人物关系建议。先提取明确设定并检索已有角色；sources 的 quote 必须逐字来自本轮作者输入并包含字段值。无确切来源的字段留空或作为 AI 建议。只生成待审核提案，不写小说文件。最小参数示例：{"characters":[{"card":{"id":"character-001","name":"示例角色","role":"other"},"sources":[]}],"relationships":[]}。未知年龄、家庭等字段直接省略，不要用 null、0、空串占位，更不要编造以填满 Schema。card.relationships 必须为空，关系放在外层 relationships，关系 ID 以 relationship- 开头。',
  schema: CharacterDesignSchema,
  parameters: z.toJSONSchema(CharacterDesignSchema, { io: 'input' }),
  mutating: true,
  async execute(args, context) {
    const changes = await designCharacters(args, context);
    context.pending.push(...changes);
    return {
      data: {
        queued: true,
        files: changes.map((c) => c.filePath),
        note: '已生成待审核角色与关系提案。接受文件不等于确认 AI 建议。',
      },
      summary: `提议创建 ${args.characters.length} 位人物、${args.relationships.length} 条关系`,
    };
  },
});
export const proposeCharacterUpdateTool = defineTool({
  name: 'propose_character_update',
  description:
    '局部更新已生成的角色卡，仅提交受影响的叶字段；保持 ID、其他字段、手写备注和事实变更链。确认字段的新值必须有作者本轮原话 quote，AI 建议不得静默覆盖已确认或已否决的设定。不支持结构被手动修改的旧卡自动迁移。',
  schema: CharacterUpdateSchema,
  parameters: z.toJSONSchema(CharacterUpdateSchema, { io: 'input' }),
  mutating: true,
  async execute(args, context) {
    const change = await updateCharacter(args, context);
    context.pending.push(change);
    return {
      data: { queued: true, path: change.filePath, note: '仅提交指定字段，等待作者审核。' },
      summary: change.summary,
    };
  },
});

export const getRelationshipsTool = defineTool({
  name: 'get_relationships',
  description: '读取有方向的人物关系建议与状态。draft 仅为未确认建议，不可当作既定关系。',
  schema: z.object({ characterId: z.string().optional() }).strict(),
  parameters: {
    type: 'object',
    properties: { characterId: { type: 'string' } },
    additionalProperties: false,
  },
  mutating: false,
  async execute(args, context) {
    const files = (await context.project.listFiles()).filter(
      (f) => f.path.startsWith('plot/relationships/') && f.path.endsWith('.md'),
    );
    const relationships = [];
    for (const file of files) {
      const parsed = CharacterRelationshipSchema.parse(
        parseMarkdown(await context.project.readFile(file.path)).frontmatter,
      );
      if (
        !args.characterId ||
        parsed.sourceCharacterId === args.characterId ||
        parsed.targetCharacterId === args.characterId
      ) {
        relationships.push({ path: file.path, relationship: parsed });
      }
    }
    return {
      data: { relationships, note: '关系是有方向的；draft 状态仅为建议。' },
      summary: `读取 ${relationships.length} 条人物关系`,
    };
  },
});
