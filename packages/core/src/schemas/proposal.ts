import { z } from 'zod';

/**
 * Change proposals are the only path from AI output to real files.
 * A proposal is immutable once created; approval produces a commit record.
 */

export const ChangeOperationSchema = z.enum(['create', 'update', 'delete']);
export type ChangeOperation = z.infer<typeof ChangeOperationSchema>;

export const WorldImpactSchema = z.object({
  scope: z.literal('explicit-and-text'),
  files: z.array(
    z.object({
      filePath: z.string().min(1),
      contentHash: z.string().min(1),
      evidence: z
        .array(
          z.object({
            line: z.number().int().positive(),
            excerpt: z.string(),
            reason: z.enum(['explicit_reference', 'text_match']),
          }),
        )
        .min(1),
    }),
  ),
});
export type WorldImpact = z.infer<typeof WorldImpactSchema>;

export const FileChangeSchema = z
  .object({
    id: z.string().min(1),
    operation: ChangeOperationSchema,
    /** Project-relative POSIX path, e.g. `chapters/001.md`. */
    filePath: z.string().min(1),
    /**
     * Hash of the file content the proposal was generated against.
     * null for `create` operations (or when the file did not exist).
     */
    baseContentHash: z.string().nullable(),
    /** New content for create/update. Empty for delete. */
    nextContent: z.string().default(''),
    /** Previous content captured for diffing/rollback; null for create. */
    previousContent: z.string().nullable(),
    /** Human-readable one-line summary of the change. */
    summary: z.string().default(''),
    worldImpact: WorldImpactSchema.optional(),
    dependsOnPaths: z.array(z.string().min(1)).optional(),
    dependencyContentHashes: z.record(z.string(), z.string()).optional(),
    /** Category used for grouping in the review UI. */
    kind: z.enum(['chapter', 'character', 'world', 'plot', 'other']).default('other'),
  })
  .refine((change) => change.operation !== 'delete' || change.nextContent === '', {
    message: 'delete operations must not carry nextContent',
  });
export type FileChange = z.infer<typeof FileChangeSchema>;

export const ProposalStatusSchema = z.enum([
  'pending',
  'partially_accepted',
  'accepted',
  'rejected',
  'stale',
  'failed',
]);
export type ProposalStatus = z.infer<typeof ProposalStatusSchema>;

/** Per-item review decision. */
export const ChangeDecisionSchema = z.enum(['pending', 'accepted', 'rejected']);
export type ChangeDecision = z.infer<typeof ChangeDecisionSchema>;

export const ChangeProposalSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  rationale: z.string().default(''),
  /** Conversation/task that produced this proposal. */
  sourceTaskId: z.string().optional(),
  createdAt: z.string().min(1),
  status: ProposalStatusSchema.default('pending'),
  changes: z.array(FileChangeSchema).min(1),
  decisions: z.record(z.string(), ChangeDecisionSchema).default({}),
  /** True when the author must explicitly confirm (delete/bulk/overwrite). */
  requiresExplicitConfirmation: z.boolean().default(false),
});
export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;

export const CommitResultSchema = z.object({
  proposalId: z.string().min(1),
  committedAt: z.string().min(1),
  /** Files actually written, with the hash after writing. */
  written: z.array(
    z.object({
      filePath: z.string().min(1),
      contentHash: z.string().min(1),
      operation: ChangeOperationSchema,
    }),
  ),
  /** Snapshot created before the write (enables one-click rollback). */
  snapshotId: z.string().nullable(),
  rollbackToken: z.string().min(1),
});
export type CommitResult = z.infer<typeof CommitResultSchema>;

/** Detects whether an approved change is still safe to apply. */
export const VersionCheckSchema = z.object({
  filePath: z.string().min(1),
  expectedHash: z.string().nullable(),
  actualHash: z.string().nullable(),
  status: z.enum(['ok', 'missing', 'conflict']),
});
export type VersionCheck = z.infer<typeof VersionCheckSchema>;
