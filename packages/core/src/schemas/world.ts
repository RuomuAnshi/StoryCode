import { z } from 'zod';
import { DraftStatusSchema } from './common.js';

export const WorldEntitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  factIds: z.array(z.string()).default([]),
});
export type WorldEntity = z.infer<typeof WorldEntitySchema>;

export const WorldRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  exceptions: z.array(z.string()).default([]),
  factIds: z.array(z.string()).default([]),
});
export type WorldRule = z.infer<typeof WorldRuleSchema>;

export const WorldEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  date: z.string().optional(),
  description: z.string().default(''),
  relatedEntities: z.array(z.string()).default([]),
});
export type WorldEvent = z.infer<typeof WorldEventSchema>;

export const WorldSettingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  genre: z.array(z.string().min(1)).default([]),
  themes: z.array(z.string().min(1)).default([]),
  tone: z.array(z.string().min(1)).default([]),
  era: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  institutions: z.array(WorldEntitySchema).default([]),
  factions: z.array(WorldEntitySchema).default([]),
  rules: z.array(WorldRuleSchema).default([]),
  history: z.array(WorldEventSchema).default([]),
  socialConflicts: z.array(z.string().min(1)).default([]),
  confirmedFacts: z.array(z.string()).default([]),
  unresolvedQuestions: z.array(z.string()).default([]),
  status: DraftStatusSchema.default('draft'),
});
export type WorldSetting = z.infer<typeof WorldSettingSchema>;

/**
 * A candidate world direction presented to the author when only characters
 * exist. Deliberately shallow: the spec forbids resolving a whole world
 * without the author choosing a direction first.
 */
export const WorldProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  genre: z.array(z.string().min(1)).min(1),
  era: z.string().min(1),
  coreConflict: z.string().min(1),
  premise: z.string().min(1),
  tone: z.array(z.string().min(1)).default([]),
  /** Why these characters fit this world. */
  characterFit: z.string().min(1),
  risks: z.array(z.string()).default([]),
  status: DraftStatusSchema.default('draft'),
});
export type WorldProposal = z.infer<typeof WorldProposalSchema>;
