import { z } from 'zod';
import { DraftStatusSchema } from './common.js';

export const CharacterRoleSchema = z.enum(['protagonist', 'supporting', 'antagonist', 'other']);
export type CharacterRole = z.infer<typeof CharacterRoleSchema>;

/**
 * Character cards intentionally allow empty arrays and optional blocks: the spec
 * forbids inventing details merely to fill the form. Validation therefore checks
 * *shape*, not completeness.
 */
export const CharacterBasicsSchema = z.object({
  age: z.number().int().positive().max(100000).optional(),
  gender: z.string().min(1).optional(),
  identity: z.string().min(1).optional(),
  affiliation: z.string().min(1).optional(),
  appearance: z.string().min(1).optional(),
});
export type CharacterBasics = z.infer<typeof CharacterBasicsSchema>;

export const CharacterPersonalitySchema = z.object({
  traits: z.array(z.string().min(1)).default([]),
  strengths: z.array(z.string().min(1)).default([]),
  flaws: z.array(z.string().min(1)).default([]),
  fears: z.array(z.string().min(1)).default([]),
  desires: z.array(z.string().min(1)).default([]),
  contradictions: z.array(z.string().min(1)).default([]),
});
export type CharacterPersonality = z.infer<typeof CharacterPersonalitySchema>;

export const CharacterBackgroundSchema = z.object({
  biography: z.string().default(''),
  family: z.string().min(1).optional(),
  formativeEvents: z.array(z.string().min(1)).default([]),
});
export type CharacterBackground = z.infer<typeof CharacterBackgroundSchema>;

export const CharacterNarrativeSchema = z.object({
  goals: z.array(z.string().min(1)).default([]),
  motivations: z.array(z.string().min(1)).default([]),
  internalConflict: z.string().min(1).optional(),
  externalConflict: z.string().min(1).optional(),
  characterArc: z.string().min(1).optional(),
  storyFunction: z.string().min(1).optional(),
});
export type CharacterNarrative = z.infer<typeof CharacterNarrativeSchema>;

export const CharacterVoiceSchema = z.object({
  dialogueStyle: z.string().min(1).optional(),
  verbalHabits: z.array(z.string().min(1)).default([]),
  examples: z.array(z.string().min(1)).default([]),
});
export type CharacterVoice = z.infer<typeof CharacterVoiceSchema>;

export const CharacterCardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)).default([]),
  role: CharacterRoleSchema,
  basics: CharacterBasicsSchema.default({}),
  personality: CharacterPersonalitySchema.default({
    traits: [],
    strengths: [],
    flaws: [],
    fears: [],
    desires: [],
    contradictions: [],
  }),
  background: CharacterBackgroundSchema.default({ biography: '', formativeEvents: [] }),
  narrative: CharacterNarrativeSchema.default({ goals: [], motivations: [] }),
  relationships: z.array(z.string()).default([]),
  secrets: z.array(z.string().min(1)).default([]),
  voice: CharacterVoiceSchema.default({ verbalHabits: [], examples: [] }),
  knowledgeState: z.array(z.string()).default([]),
  status: DraftStatusSchema.default('draft'),
  factIds: z.array(z.string()).default([]),
});
export type CharacterCard = z.infer<typeof CharacterCardSchema>;

/** Fields editable through conversational refinement; used to compute diffs. */
export const CHARACTER_EDITABLE_PATHS = [
  'name',
  'aliases',
  'role',
  'basics',
  'personality',
  'background',
  'narrative',
  'relationships',
  'secrets',
  'voice',
  'knowledgeState',
  'status',
] as const;
