import { z } from 'zod';
import { WorldDirectionsInputSchema, WorldDesignSchema, WorldUpdateSchema } from '@storycode/core';
import { proposeWorldDirections, refineWorld, updateWorld } from '../workflows/world-builder.js';
import { defineTool } from './types.js';
export const proposeWorldDirectionsTool = defineTool({
  name: 'propose_world_directions',
  description:
    '根据项目已有、含明确设定的人物生成世界观方向。original 必须提供三个在时代、题材、核心矛盾上有区别的候选；existing 仅一个，existingWorld 与 sourceQuote 必须逐字来自作者本轮输入。此工具只展示候选，不创建正式世界观，不代替作者选择。请结束回复并等待作者点击候选。',
  schema: WorldDirectionsInputSchema,
  parameters: z.toJSONSchema(WorldDirectionsInputSchema, { io: 'input' }),
  mutating: true,
  async execute(args, context) {
    const worldDirections = await proposeWorldDirections(args, context);
    return {
      worldDirections,
      data: {
        id: worldDirections.id,
        candidates: worldDirections.candidates,
        note: '等待作者在应用中点击选择；尚未生成任何正式世界观文件。',
      },
      summary: `提出 ${worldDirections.candidates.length} 个世界观方向，等待作者选择`,
    };
  },
});
export const proposeWorldSettingTool = defineTool({
  name: 'propose_world_setting',
  description:
    '仅在作者已于应用中选定方向后细化所选世界观。setting 的 title、era、genre 必须与选定候选完全一致；人物引用由应用提供，不可混入其他候选。只填必要组织、规则、历史、主题、社会冲突与待确认问题；未知字段省略。confirmedFacts 与 factIds 保持空，所有新增细节为待确认建议。审核后才写入 world/overview.md。',
  schema: WorldDesignSchema,
  parameters: z.toJSONSchema(WorldDesignSchema, { io: 'input' }),
  mutating: true,
  async execute(args, context) {
    const change = await refineWorld(args, context);
    context.pending.push(change);
    return {
      data: {
        queued: true,
        path: change.filePath,
        note: '所选方向的细化已进入待审核提案，尚未写入。',
      },
      summary: change.summary,
    };
  },
});

export const proposeWorldUpdateTool = defineTool({
  name: 'propose_world_update',
  description:
    '局部更新已有世界观的 themes（主题）、tone（基调）、unresolvedQuestions（待确认问题）、socialConflicts（社会冲突）、institutions（组织）、factions（阵营）、rules（规则）、history（历史）。values 是该字段的完整新列表。仅支持 AI 未确认草稿，保留其他正文与旧值记录。若对应正文有手动修改或设定已确认会拒绝。实体 ID 应保持稳定；删除实体不可留下历史悬空引用。时代、题材和方向暂不支持更新。只生成审核提案，不直接写入。',
  schema: WorldUpdateSchema,
  parameters: z.toJSONSchema(WorldUpdateSchema, { io: 'input' }),
  mutating: true,
  async execute(args, context) {
    const change = await updateWorld(args, context);
    context.pending.push(change);
    return {
      data: {
        queued: true,
        path: change.filePath,
        note: '等待作者审核；其他文件的语义影响尚未自动检查。',
      },
      summary: change.summary,
    };
  },
});
