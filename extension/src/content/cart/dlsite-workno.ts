import { z } from "zod";

import { isValidDlsiteWorkno } from "@adp/shared/adapters/dlsite";

/**
 * DLsite workno trust boundary (local zod + repository-documented format).
 * Format matches prototype/dlsite (WORKNO_RE / `[BRV][JE]\d{6,8}`) and
 * shared adapters `isValidDlsiteWorkno` — no overnarrow guess beyond that.
 * Rejects path/meta characters (e.g. `../../api/sensitive`).
 */
const DlsiteWorknoSchema = z
  .string()
  .trim()
  .min(1)
  .transform((s) => s.toUpperCase())
  .refine((s) => isValidDlsiteWorkno(s), { message: "invalid dlsite workno" })
  .refine((s) => !/[./\\?#%]/.test(s), {
    message: "workno must not contain path/meta characters",
  });

/** Validate and normalize a cart workno; null if untrusted. */
export function parseDlsiteWorkno(raw: unknown): string | null {
  const parsed = DlsiteWorknoSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Path-safe workno for authenticated delete/restore URL assembly.
 * Validates first; then encodeURIComponent (identity for the documented charset).
 */
export function encodeDlsiteWorknoForUrl(raw: unknown): string | null {
  const workno = parseDlsiteWorkno(raw);
  if (!workno) return null;
  return encodeURIComponent(workno);
}
