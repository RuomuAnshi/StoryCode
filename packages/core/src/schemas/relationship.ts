import { z } from 'zod';
import { DraftStatusSchema } from './common.js';

export const RelationshipTypeSchema = z.enum([
  'friendship',
  'rivalry',
  'family',
  'romance',
  'conflict',
  'alliance',
  'other',
]);
export type RelationshipType = z.infer<typeof RelationshipTypeSchema>;

/**
 * Relationships are directed: A may consider B a friend while B considers A a
 * rival, so perspectives are stored per direction.
 */
export const CharacterRelationshipSchema = z.object({
  id: z.string().min(1),
  sourceCharacterId: z.string().min(1),
  targetCharacterId: z.string().min(1),
  type: RelationshipTypeSchema,
  description: z.string().default(''),
  sourcePerspective: z.string().optional(),
  targetPerspective: z.string().optional(),
  initialState: z.string().optional(),
  currentState: z.string().optional(),
  relatedEvents: z.array(z.string()).default([]),
  status: DraftStatusSchema.default('draft'),
});
export type CharacterRelationship = z.infer<typeof CharacterRelationshipSchema>;

export const RELATIONSHIP_TYPE_LABELS: Record<RelationshipType, string> = {
  friendship: '友情',
  rivalry: '竞争',
  family: '亲缘',
  romance: '情感',
  conflict: '敌对',
  alliance: '同盟',
  other: '其他',
};

/** Read-only graph derived from authoritative project Markdown. */
export const RelationshipGraphSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      filePath: z.string().optional(),
      missing: z.boolean(),
    }),
  ),
  edges: z.array(
    CharacterRelationshipSchema.extend({
      filePath: z.string(),
      displayStatus: z.enum(['confirmed', 'proposed', 'rejected', 'superseded']),
    }),
  ),
  warnings: z.array(z.string()),
});
export type RelationshipGraph = z.infer<typeof RelationshipGraphSchema>;
