import { LookupResponseSchema } from "@adp/shared";
import { MSG_LOOKUP } from "../messages.js";
import type { LookupHit } from "./types.js";

export interface LookupRequestItem {
  source?: string;
  cid?: string;
  title?: string;
  maker?: string;
}

interface RawLookupReply {
  ok?: boolean;
  results?: unknown;
}

/** Silent-failure lookup: returns null when the service worker or server is unavailable. */
export async function lookupItems(
  items: LookupRequestItem[],
): Promise<LookupHit[] | null> {
  if (items.length === 0) return [];
  try {
    const reply = (await chrome.runtime.sendMessage({
      type: MSG_LOOKUP,
      items,
    })) as RawLookupReply | undefined;
    if (!reply?.ok || reply.results === undefined) return null;
    const parsed = LookupResponseSchema.safeParse({ results: reply.results });
    if (!parsed.success) return null;
    return parsed.data.results;
  } catch {
    return null;
  }
}
