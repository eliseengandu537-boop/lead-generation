import { z } from "zod";
export const evidenceSchema = z.object({
  url: z.url().max(2000),
  title: z.string().max(500),
  excerpt: z.string().max(6000),
  fetchedAt: z.iso.datetime(),
  kind: z.enum(["SEARCH", "WEBSITE"]).optional(),
});
export type Evidence = z.infer<typeof evidenceSchema>;
export const analysisSchema = z.object({
  summary: z.string().min(1).max(2000),
  fitReason: z.string().min(1).max(1500),
  facts: z
    .array(
      z.object({
        claim: z.string().min(1).max(500),
        sourceUrl: z.url().max(2000),
        quote: z.string().min(8).max(600),
      }),
    )
    .max(6),
  cautions: z.array(z.string().max(500)).max(8),
  subject: z
    .string()
    .min(1)
    .max(200)
    .refine((v) => !/[\r\n]/.test(v), "Subject must be a single line"),
  body: z.string().min(1).max(6000),
});
export type Analysis = z.infer<typeof analysisSchema>;
