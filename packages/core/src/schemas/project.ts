import { z } from 'zod';

export const ProjectMetaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Project schema version, bumped when the on-disk layout changes. */
  schemaVersion: z.number().int().positive().default(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  description: z.string().default(''),
  author: z.string().default(''),
  wordCountGoal: z.number().int().nonnegative().optional(),
});
export type ProjectMeta = z.infer<typeof ProjectMetaSchema>;

export const CHAPTER_STATUS = ['draft', 'revised', 'final'] as const;
export const ChapterStatusSchema = z.enum(CHAPTER_STATUS);
export type ChapterStatus = z.infer<typeof ChapterStatusSchema>;

export const ChapterMetaSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  order: z.number().int().positive(),
  status: ChapterStatusSchema.default('draft'),
  volumeId: z.string().optional(),
  /** Character IDs appearing in this chapter (indexed, not authoritative). */
  characterIds: z.array(z.string()).default([]),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type ChapterMeta = z.infer<typeof ChapterMetaSchema>;

export const FileNodeKindSchema = z.enum([
  'project',
  'folder',
  'chapter',
  'character',
  'world',
  'plot',
  'other',
]);
export type FileNodeKind = z.infer<typeof FileNodeKindSchema>;

export interface FileNode {
  kind: FileNodeKind;
  /** Project-relative POSIX path. */
  path: string;
  name: string;
  children?: FileNode[];
  /** Set for chapters so the tree can order by narrative sequence. */
  chapterOrder?: number;
  /** Entity id from frontmatter when known. */
  entityId?: string;
}

export const ProjectFileSchema = z.object({
  path: z.string().min(1),
  entityId: z.string().optional(),
  title: z.string().default(''),
  type: z.string().default('other'),
  /** Content hash for change detection. */
  hash: z.string().default(''),
  updatedAt: z.string().default(''),
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
