import { z } from 'zod';
import { CharacterCardSchema } from './character.js';
import { CharacterRelationshipSchema } from './relationship.js';
import { StoryFactSchema } from './common.js';

export const CharacterFieldSchema = z.enum([
  'name',
  'aliases',
  'role',
  'basics.age',
  'basics.gender',
  'basics.identity',
  'basics.affiliation',
  'basics.appearance',
  'personality.traits',
  'personality.strengths',
  'personality.flaws',
  'personality.fears',
  'personality.desires',
  'personality.contradictions',
  'background.biography',
  'background.family',
  'background.formativeEvents',
  'narrative.goals',
  'narrative.motivations',
  'narrative.internalConflict',
  'narrative.externalConflict',
  'narrative.characterArc',
  'narrative.storyFunction',
  'secrets',
  'voice.dialogueStyle',
  'voice.verbalHabits',
  'voice.examples',
  'knowledgeState',
]);
export type CharacterField = z.infer<typeof CharacterFieldSchema>;
export const CharacterFieldValueSchema = z.union([z.string(), z.number(), z.array(z.string())]);
export const CharacterSourceSchema = z
  .object({ field: CharacterFieldSchema, quote: z.string().min(1).max(2000) })
  .strict();
export const CharacterFactSchema = StoryFactSchema.extend({ userQuote: z.string().optional() });
export type CharacterFact = z.infer<typeof CharacterFactSchema>;
export const CharacterDesignSchema = z
  .object({
    characters: z
      .array(
        z
          .object({
            card: CharacterCardSchema.extend({
              id: z.string().regex(/^character-[a-z0-9]+(?:-[a-z0-9]+)*$/i),
              relationships: z.array(z.string()).max(0).default([]),
            }).describe(
              '只填真实必要字段。最小卡片只需 id、name、role；未知的 age、family 等可选字段必须省略，不填 null、0 或空串。',
            ),
            sources: z.array(CharacterSourceSchema).default([]),
          })
          .strict(),
      )
      .min(1)
      .max(6),
    relationships: z
      .array(
        CharacterRelationshipSchema.extend({
          id: z.string().regex(/^relationship-[a-z0-9]+(?:-[a-z0-9]+)*$/i),
        }),
      )
      .max(12)
      .default([]),
  })
  .strict();
export type CharacterDesign = z.infer<typeof CharacterDesignSchema>;
export const CharacterUpdateSchema = z
  .object({
    path: z.string().min(1),
    changes: z
      .array(
        z
          .object({
            field: CharacterFieldSchema,
            value: CharacterFieldValueSchema,
            quote: z.string().min(1).max(2000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(28),
  })
  .strict();
export type CharacterUpdate = z.infer<typeof CharacterUpdateSchema>;
