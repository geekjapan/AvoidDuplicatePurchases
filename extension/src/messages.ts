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

// ---------------------------------------------------------------------------
// Live cross-store price discovery (ephemeral; never posts price_observation)
// Wave 1: dlsite maniax ↔ fanza_doujin only.
// ---------------------------------------------------------------------------

/** Sources that participate in wave-1 auto discovery. */
export const DISCOVERY_SOURCES = ["dlsite", "fanza_doujin"] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export const MSG_DISCOVERY_START = "adp:discovery-start";
export const MSG_DISCOVERY_SELECT = "adp:discovery-select-candidate";
export const MSG_DISCOVERY_STATUS = "adp:discovery-status";
export const MSG_DISCOVERY_RESULT = "adp:discovery-result";
export const MSG_DISCOVERY_READ_SEARCH = "adp:discovery-read-search";
export const MSG_DISCOVERY_READ_PRODUCT = "adp:discovery-read-product-prices";

export const DISCOVERY_FAILURE_CODES = [
  "discovery_login_required",
  "discovery_age_gate",
  "discovery_search_timeout",
  "discovery_no_match",
  "discovery_ambiguous",
  "discovery_product_mismatch",
  "discovery_price_unavailable",
  "discovery_blocked_policy",
  "discovery_unsupported_source",
  "discovery_invalid_request",
  "discovery_no_tab",
  "discovery_url_too_long",
  "discovery_receiver_not_ready",
  "discovery_session_lost",
  "discovery_cancelled",
] as const;

export type DiscoveryFailureCode = (typeof DISCOVERY_FAILURE_CODES)[number];

export const DiscoveryMoneySchema = z
  .object({
    amountMinor: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    taxStatus: z.enum(["included", "excluded", "unknown"]),
  })
  .strict();

export type DiscoveryMoney = z.infer<typeof DiscoveryMoneySchema>;

export const DiscoveryPriceTiersSchema = z
  .object({
    regular: DiscoveryMoneySchema.nullable(),
    sale: DiscoveryMoneySchema.nullable(),
    coupon: DiscoveryMoneySchema.nullable(),
  })
  .strict();

export type DiscoveryPriceTiers = z.infer<typeof DiscoveryPriceTiersSchema>;

export const DiscoveryCandidateSchema = z
  .object({
    targetSource: z.enum(DISCOVERY_SOURCES),
    cid: z.string().min(1),
    title: z.string().min(1),
    maker: z.string().nullable(),
    productUrl: z.string().url(),
    rank: z.number().int().positive(),
  })
  .strict();

export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidateSchema>;

export interface DiscoveryStartMessage {
  type: typeof MSG_DISCOVERY_START;
  sessionId: string;
  source: DiscoverySource;
  cid: string;
  title: string;
  maker: string | null;
  pageUrl: string;
  originTiers: DiscoveryPriceTiers;
}

export const DiscoveryStartMessageSchema = z
  .object({
    type: z.literal(MSG_DISCOVERY_START),
    sessionId: z.string().min(1),
    source: z.enum(DISCOVERY_SOURCES),
    cid: z.string().min(1),
    title: z.string().min(1),
    maker: z.string().nullable(),
    pageUrl: z.string().min(1),
    originTiers: DiscoveryPriceTiersSchema,
  })
  .strict();

export interface DiscoverySelectMessage {
  type: typeof MSG_DISCOVERY_SELECT;
  sessionId: string;
  productUrl: string;
  targetSource: DiscoverySource;
  cid: string;
}

export const DiscoverySelectMessageSchema = z
  .object({
    type: z.literal(MSG_DISCOVERY_SELECT),
    sessionId: z.string().min(1),
    productUrl: z.string().url(),
    targetSource: z.enum(DISCOVERY_SOURCES),
    cid: z.string().min(1),
  })
  .strict();

export type DiscoveryStartReply =
  | { ok: true; sessionId: string }
  | { ok: false; error: DiscoveryFailureCode | string };

export type DiscoverySelectReply =
  | { ok: true; sessionId: string }
  | { ok: false; error: DiscoveryFailureCode | string };

/** Progress push from background → origin tab (fire-and-forget). */
export type DiscoveryStatusMessage = {
  type: typeof MSG_DISCOVERY_STATUS;
  sessionId: string;
  phase:
    | "searching"
    | "scoring"
    | "awaiting_selection"
    | "opening_product"
    | "reading_prices"
    | "failed"
    | "done";
  message?: string;
  failureCode?: DiscoveryFailureCode;
};

export type DiscoveryResultMessage =
  | {
      type: typeof MSG_DISCOVERY_RESULT;
      sessionId: string;
      ok: true;
      kind: "compare";
      targetSource: DiscoverySource;
      targetCid: string;
      targetTitle: string;
      targetMaker: string | null;
      targetProductUrl: string;
      originTiers: DiscoveryPriceTiers;
      targetTiers: DiscoveryPriceTiers;
    }
  | {
      type: typeof MSG_DISCOVERY_RESULT;
      sessionId: string;
      ok: true;
      kind: "candidates";
      targetSource: DiscoverySource;
      candidates: DiscoveryCandidate[];
      originTiers: DiscoveryPriceTiers;
    }
  | {
      type: typeof MSG_DISCOVERY_RESULT;
      sessionId: string;
      ok: false;
      failureCode: DiscoveryFailureCode;
      message?: string;
    };

export const DiscoveryResultMessageSchema: z.ZodType<DiscoveryResultMessage> = z.union([
  z
    .object({
      type: z.literal(MSG_DISCOVERY_RESULT),
      sessionId: z.string().min(1),
      ok: z.literal(true),
      kind: z.literal("compare"),
      targetSource: z.enum(DISCOVERY_SOURCES),
      targetCid: z.string().min(1),
      targetTitle: z.string().min(1),
      targetMaker: z.string().nullable(),
      targetProductUrl: z.string().url(),
      originTiers: DiscoveryPriceTiersSchema,
      targetTiers: DiscoveryPriceTiersSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal(MSG_DISCOVERY_RESULT),
      sessionId: z.string().min(1),
      ok: z.literal(true),
      kind: z.literal("candidates"),
      targetSource: z.enum(DISCOVERY_SOURCES),
      candidates: z.array(DiscoveryCandidateSchema).max(10),
      originTiers: DiscoveryPriceTiersSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal(MSG_DISCOVERY_RESULT),
      sessionId: z.string().min(1),
      ok: z.literal(false),
      failureCode: z.enum(DISCOVERY_FAILURE_CODES),
      message: z.string().optional(),
    })
    .strict(),
]);

export interface DiscoveryReadSearchMessage {
  type: typeof MSG_DISCOVERY_READ_SEARCH;
  targetSource: DiscoverySource;
}

export type DiscoverySearchReply =
  | {
      ok: true;
      state: "ready";
      pageUrl: string;
      candidates: DiscoveryCandidate[];
    }
  | { ok: true; state: "empty"; pageUrl: string; candidates: [] }
  | { ok: true; state: "login"; pageUrl: string }
  | { ok: true; state: "age_gate"; pageUrl: string }
  | { ok: true; state: "page_not_ready"; pageUrl: string }
  | { ok: false; error: string };

export const DiscoverySearchReplySchema: z.ZodType<DiscoverySearchReply> = z.union([
  z
    .object({
      ok: z.literal(true),
      state: z.literal("ready"),
      pageUrl: z.string(),
      candidates: z.array(DiscoveryCandidateSchema).max(30),
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      state: z.literal("empty"),
      pageUrl: z.string(),
      candidates: z.tuple([]),
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
      state: z.literal("age_gate"),
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

export interface DiscoveryReadProductMessage {
  type: typeof MSG_DISCOVERY_READ_PRODUCT;
  targetSource: DiscoverySource;
  expectedCid: string;
}

export type DiscoveryProductReply =
  | {
      ok: true;
      state: "ready";
      pageUrl: string;
      cid: string;
      title: string;
      maker: string | null;
      tiers: DiscoveryPriceTiers;
    }
  | { ok: true; state: "page_not_ready"; pageUrl: string }
  | { ok: true; state: "login"; pageUrl: string }
  | { ok: true; state: "age_gate"; pageUrl: string }
  | { ok: true; state: "mismatch"; pageUrl: string; cid: string | null }
  | { ok: false; error: string };

export const DiscoveryProductReplySchema: z.ZodType<DiscoveryProductReply> = z.union([
  z
    .object({
      ok: z.literal(true),
      state: z.literal("ready"),
      pageUrl: z.string(),
      cid: z.string().min(1),
      title: z.string().min(1),
      maker: z.string().nullable(),
      tiers: DiscoveryPriceTiersSchema,
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
      ok: z.literal(true),
      state: z.literal("login"),
      pageUrl: z.string(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      state: z.literal("age_gate"),
      pageUrl: z.string(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(true),
      state: z.literal("mismatch"),
      pageUrl: z.string(),
      cid: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.string().min(1),
    })
    .strict(),
]);

export function isDiscoverySource(value: unknown): value is DiscoverySource {
  return (
    typeof value === "string" &&
    (DISCOVERY_SOURCES as readonly string[]).includes(value)
  );
}

export function isAdpMessage(type: unknown): type is string {
  return typeof type === "string" && type.startsWith(MSG_NAMESPACE);
}

export function isAdminMessage(type: unknown): type is string {
  return typeof type === "string" && type.startsWith(MSG_ADMIN_NAMESPACE);
}
