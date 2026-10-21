import { z } from 'zod';

/** ISO-8601 timestamp string. */
export const IsoDateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be an ISO-8601 date-time');

export const IdSchema = z
  .string()
  .min(3)
  .max(80)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/i, 'must look like "type-suffix"');

/** Lifecycle shared by AI-authored drafts and author-confirmed content. */
export const DraftStatusSchema = z.enum(['draft', 'confirmed']);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

/** Reference back to the file (and optional anchor) that justifies a fact. */
export const SourceRefSchema = z.object({
  filePath: z.string().min(1),
  anchor: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;

export const FactStatusSchema = z.enum([
  'user_confirmed',
  'source_confirmed',
  'ai_proposed',
  'inferred',
  'rejected',
  'superseded',
]);
export type FactStatus = z.infer<typeof FactStatusSchema>;

export const StoryFactSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  predicate: z.string().min(1),
  value: z.string().min(1),
  status: FactStatusSchema,
  sourceRefs: z.array(SourceRefSchema).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  supersedes: z.array(z.string()).optional(),
});
export type StoryFact = z.infer<typeof StoryFactSchema>;

/**
 * Facts that come from AI are never silently authoritative.
 * This predicate is the single gate used by the UI to decide whether a value
 * may be presented as established canon.
 */
export function isAuthoritativeFact(status: FactStatus): boolean {
  return status === 'user_confirmed' || status === 'source_confirmed';
}

/** Facts that are visible in reviews but must not be written as canon. */
export function isProvisionalFact(status: FactStatus): boolean {
  return status === 'ai_proposed' || status === 'inferred';
}

/** Ordered severity used for continuity reporting. */
export const SeveritySchema = z.enum(['error', 'warning', 'info']);
export type Severity = z.infer<typeof SeveritySchema>;
