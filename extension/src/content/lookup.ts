import { MSG_LOOKUP } from "../messages.js";
import type { LookupHit } from "./types.js";

export interface LookupRequestItem {
  source?: string;
  cid?: string;
  title?: string;
  maker?: string;
}

interface LookupReply {
  ok: boolean;
  results?: LookupHit[];
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
    })) as LookupReply | undefined;
    if (!reply?.ok || !reply.results) return null;
    return reply.results;
  } catch {
    return null;
  }
}
