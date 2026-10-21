import { z } from 'zod';
export const AuthorQuestionSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    options: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(80),
            description: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .min(2)
      .max(4),
  })
  .strict()
  .refine(
    (value) => new Set(value.options.map((option) => option.label)).size === value.options.length,
    { message: '选项名称不可重复' },
  );
export type AuthorQuestion = z.infer<typeof AuthorQuestionSchema>;
