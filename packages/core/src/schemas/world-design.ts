import { z } from 'zod';
import {
  WorldProposalSchema,
  WorldSettingSchema,
  WorldEntitySchema,
  WorldRuleSchema,
} from './world.js';

export const WorldDirectionsInputSchema = z
  .object({
    mode: z
      .enum(['original', 'existing'])
      .describe('original 必须给出三个差异明显的方向；existing 只给一个基于作者指定世界观的方向。'),
    existingWorld: z.string().min(1).optional(),
    sourceQuote: z.string().min(1).optional(),
    characterIds: z.array(z.string().min(1)).min(1).max(6),
    candidates: z.array(WorldProposalSchema).min(1).max(3),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'original' && (value.existingWorld || value.sourceQuote))
      ctx.addIssue({
        code: 'custom',
        message: '原创路径不能携带既有世界观名称或原话；请正确选择 mode。',
      });
    if (value.mode === 'original' && value.candidates.length !== 3)
      ctx.addIssue({ code: 'custom', path: ['candidates'], message: '原创世界观必须提供三个方向' });
    if (
      value.mode === 'existing' &&
      (value.candidates.length !== 1 || !value.existingWorld || !value.sourceQuote)
    )
      ctx.addIssue({ code: 'custom', message: '既有世界观需要名称、作者原话及一个方向' });
  });
export type WorldDirectionsInput = z.infer<typeof WorldDirectionsInputSchema>;
export const WorldDirectionsSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  projectRoot: z.string().min(1),
  mode: z.enum(['original', 'existing']),
  existingWorld: z.string().optional(),
  sourceQuote: z.string().optional(),
  characters: z
    .array(z.object({ id: z.string(), name: z.string(), path: z.string(), hash: z.string() }))
    .min(1),
  candidates: z.array(WorldProposalSchema).min(1).max(3),
});
export type WorldDirections = z.infer<typeof WorldDirectionsSchema>;
export const WorldSelectionSchema = z
  .object({ directions: WorldDirectionsSchema, candidateId: z.string().min(1) })
  .strict();
export type WorldSelection = z.infer<typeof WorldSelectionSchema>;
export const WorldDesignSchema = z
  .object({
    setting: WorldSettingSchema.extend({
      id: z.string().regex(/^world-[a-z0-9]+(?:-[a-z0-9]+)*$/i),
      themes: z.array(z.string().trim().min(1)).min(1).max(12),
      confirmedFacts: z.array(z.string()).max(0).default([]),
      institutions: z
        .array(WorldEntitySchema.extend({ factIds: z.array(z.string()).max(0).default([]) }))
        .default([]),
      factions: z
        .array(WorldEntitySchema.extend({ factIds: z.array(z.string()).max(0).default([]) }))
        .default([]),
      rules: z
        .array(WorldRuleSchema.extend({ factIds: z.array(z.string()).max(0).default([]) }))
        .default([]),
    }),
  })
  .strict();
export type WorldDesign = z.infer<typeof WorldDesignSchema>;

const UpdateTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .regex(/^[^\r\n]+$/);
const UpdateEntitySchema = WorldEntitySchema.extend({
  id: UpdateTextSchema,
  name: UpdateTextSchema,
  description: UpdateTextSchema,
  factIds: z.array(z.string()).max(0).default([]),
}).strict();
export const WorldUpdateSchema = z.discriminatedUnion('field', [
  z
    .object({
      field: z.enum(['themes', 'tone', 'unresolvedQuestions', 'socialConflicts']),
      values: z.array(UpdateTextSchema).min(1).max(12),
    })
    .strict(),
  z
    .object({
      field: z.enum(['institutions', 'factions']),
      values: z.array(UpdateEntitySchema).max(30),
    })
    .strict(),
  z
    .object({
      field: z.literal('rules'),
      values: z
        .array(
          WorldRuleSchema.extend({
            id: UpdateTextSchema,
            description: UpdateTextSchema,
            exceptions: z.array(UpdateTextSchema).default([]),
            factIds: z.array(z.string()).max(0).default([]),
          }).strict(),
        )
        .max(30),
    })
    .strict(),
  z
    .object({
      field: z.literal('history'),
      values: z
        .array(
          z
            .object({
              id: UpdateTextSchema,
              title: UpdateTextSchema,
              date: UpdateTextSchema.optional(),
              description: UpdateTextSchema,
              relatedEntities: z.array(UpdateTextSchema).default([]),
            })
            .strict(),
        )
        .max(50),
    })
    .strict(),
]);
export type WorldUpdate = z.infer<typeof WorldUpdateSchema>;
