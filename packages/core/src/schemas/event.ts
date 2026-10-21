import { z } from 'zod';

export const StoryEventStatusSchema = z.enum(['planned', 'occurred', 'discarded']);
export type StoryEventStatus = z.infer<typeof StoryEventStatusSchema>;

export const StoryEventSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  storyTime: z.string().optional(),
  narrativeOrder: z.number().int().nonnegative().default(0),
  locationIds: z.array(z.string()).default([]),
  characterIds: z.array(z.string()).default([]),
  sourceChapterIds: z.array(z.string()).default([]),
  affectedFactIds: z.array(z.string()).default([]),
  status: StoryEventStatusSchema.default('planned'),
});
export type StoryEvent = z.infer<typeof StoryEventSchema>;

export const ContinuityIssueSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(['error', 'warning', 'info']),
  category: z.string().min(1),
  description: z.string().min(1),
  evidence: z
    .array(
      z.object({
        filePath: z.string().min(1),
        excerpt: z.string(),
      }),
    )
    .default([]),
  suggestedFix: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type ContinuityIssue = z.infer<typeof ContinuityIssueSchema>;
