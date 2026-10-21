import { z } from 'zod';
export const WebUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
}, '只支持无凭据的 HTTP(S) 网址');
export const WebSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(300),
    limit: z.number().int().min(1).max(5).default(5),
  })
  .strict();
export const WebFetchInputSchema = z.object({ url: WebUrlSchema }).strict();
export const WebSearchResultSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string().min(1).max(500),
        url: WebUrlSchema,
        snippet: z.string().max(1500),
      }),
    )
    .max(5),
});
export const WebPageSchema = z.object({
  title: z.string().max(500),
  url: WebUrlSchema,
  text: z.string().min(1).max(12000),
  truncated: z.boolean(),
});
export type WebSearchResult = z.infer<typeof WebSearchResultSchema>;
export type WebPage = z.infer<typeof WebPageSchema>;
