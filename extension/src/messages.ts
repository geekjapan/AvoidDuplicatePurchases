import {
  LibraryImportItemSchema,
  type LibraryImportItem,
  type LibrarySource,
} from "@adp/shared";
import { z } from "zod";

/** Namespace for extension ↔ service worker messages (D3, T-ADMIN-* extends below). */
export const MSG_NAMESPACE = "adp:" as const;
export const MSG_ADMIN_NAMESPACE = "adp:admin:" as const;

export const MSG_LOOKUP = "adp:lookup";
export const MSG_SYNC = "adp:sync-dlsite";
export const MSG_SERVER_STATUS = "adp:server-status";
export const MSG_AMAZON_READ_PAGE = "adp:amazon-read-page";
export const MSG_AMAZON_SYNC = "adp:amazon-sync";

/** Background → content: read the visible library page of a DOM sync source. */
export const MSG_LIBRARY_READ_PAGE = "adp:library-read-page";

/** Popup → background: run the user-initiated library sync for one source. */
export const MSG_LIBRARY_SYNC = "adp:library-sync";

/** Content → background: record visible three-tier prices for an owned listing. */
export const MSG_PRICE_OBSERVATION = "adp:price-observation";

/**
 * DOM readiness states of the library-sync protocol (scope-delta 2026-08-08):
 * login / page-not-ready / empty / ready. Classified by the provider reader;
 * the generic layer only routes them.
 */
export const LIBRARY_PAGE_STATES = [
  "login",
  "page_not_ready",
  "empty",
  "ready",
] as const;

export type LibraryPageState = (typeof LIBRARY_PAGE_STATES)[number];

/** One visible DOM item; state is reader evidence, never inferred here. */
export type LibraryDomItem = LibraryImportItem;

/**
 * Content-script reply to MSG_LIBRARY_READ_PAGE. `nextPageUrl` is a
 * provider-supplied visible pagination target; the generic layer nulls
 * unsafe URLs before this reply is sent. Single-literal `state` members
 * keep discriminated-union narrowing exact.
 */
export type LibraryPageReply =
  | {
      ok: true;
      state: "ready" | "empty";
      pageUrl: string;
      items: LibraryDomItem[];
      nextPageUrl: string | null;
    }
  | { ok: true; state: "login"; pageUrl: string }
  | { ok: true; state: "page_not_ready"; pageUrl: string }
  | { ok: false; error: string };

/**
 * Runtime boundary for chrome.tabs.sendMessage replies. Malformed ok:true
 * or ok:false shapes fail closed in the background library sync.
 */
export const LibraryPageReplySchema: z.ZodType<LibraryPageReply> = z.union([
  z
    .object({
      ok: z.literal(true),
      state: z.enum(["ready", "empty"]),
      pageUrl: z.string(),
      items: z.array(LibraryImportItemSchema),
      nextPageUrl: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      state: z.literal("login"),
      pageUrl: z.string(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      state: z.literal("page_not_ready"),
      pageUrl: z.string(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.string().min(1),
    })
    .strict(),
]);

/** Message the background sends to a tab's content script. */
export interface LibraryReadPageMessage {
  type: typeof MSG_LIBRARY_READ_PAGE;
  source: LibrarySource;
}

export interface AmazonBooksItem {
  asin: string;
  title: string;
  author: string;
  acquiredLabel: string;
  isRental: boolean;
  isRead: boolean;
}

export type AmazonBooksPageReply =
  | {
      ok: true;
      pageUrl: string;
      pageNumber: number | null;
      items: AmazonBooksItem[];
    }
  | { ok: false; error: string };

export type PriceObservationMoney = {
  amountMinor: number;
  currency: string;
  taxStatus: "included" | "excluded" | "unknown";
};

/** Content → background payload after ownership lookup succeeds. */
export interface PriceObservationMessage {
  type: typeof MSG_PRICE_OBSERVATION;
  source: string;
  cid: string;
  pageUrl: string;
  regular: PriceObservationMoney | null;
  sale: PriceObservationMoney | null;
  coupon: PriceObservationMoney | null;
}

export type PriceObservationReply =
  | { ok: true }
  | { ok: false; error?: string };

export function isAdpMessage(type: unknown): type is string {
  return typeof type === "string" && type.startsWith(MSG_NAMESPACE);
}

export function isAdminMessage(type: unknown): type is string {
  return typeof type === "string" && type.startsWith(MSG_ADMIN_NAMESPACE);
}
