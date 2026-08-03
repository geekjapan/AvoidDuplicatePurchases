import { z } from "zod";

import { SOURCES } from "./identity.js";

export const SourceSchema = z.enum(SOURCES);

export const LookupItemSchema = z.object({
  source: SourceSchema.optional(),
  cid: z.string().optional(),
  title: z.string().optional(),
  maker: z.string().optional(),
});

export const LookupRequestSchema = z.object({
  items: z.array(LookupItemSchema).min(1),
});

export const LookupOtherSchema = z.object({
  source: SourceSchema,
  cid: z.string(),
  title: z.string(),
  url: z.string().url(),
});

export const LookupResultSchema = z.object({
  owned: z.boolean(),
  other: z.array(LookupOtherSchema),
});

export const LookupResponseSchema = z.object({
  results: z.array(LookupResultSchema),
});

export const ImportResponseSchema = z.object({
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
});

export const SyncStateResponseSchema = z.object({
  cursor: z.string().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
});

export const CandidatePairSchema = z.object({
  id: z.number().int(),
  a: z.object({
    source: SourceSchema,
    cid: z.string(),
    title: z.string(),
    maker: z.string().nullable().optional(),
  }),
  b: z.object({
    source: SourceSchema,
    cid: z.string(),
    title: z.string(),
    maker: z.string().nullable().optional(),
  }),
  dice: z.number().min(0).max(1),
});

export const CandidatesResponseSchema = z.object({
  candidates: z.array(CandidatePairSchema),
});

export const CandidateDecisionSchema = z.object({
  same: z.boolean(),
});

export const RematchResponseSchema = z.object({
  rematched: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
});

export const ManualListingRequestSchema = z.object({
  url: z.string().url(),
});

export const WorkAssignmentRequestSchema = z.object({
  workId: z.number().int().positive(),
  lock: z.boolean().optional(),
});

export const ExportRequestSchema = z.object({
  destination: z.string().min(1),
});

export type LookupItem = z.infer<typeof LookupItemSchema>;
export type LookupRequest = z.infer<typeof LookupRequestSchema>;
export type LookupResult = z.infer<typeof LookupResultSchema>;
export type LookupResponse = z.infer<typeof LookupResponseSchema>;
export type ImportResponse = z.infer<typeof ImportResponseSchema>;
