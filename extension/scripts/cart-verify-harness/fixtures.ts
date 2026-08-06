import type { CartSource } from "@adp/shared";

/** Placeholder cids for dry-run only — never used for live requests. */
export const DRY_RUN_CID: Record<CartSource, string> = {
  dlsite: "RJ000000",
  "fanza-doujin": "d_000000",
  "fanza-books": "b000xxxxx00001",
};

/** Placeholder page-context values for dry-run contract checks. */
export const DRY_RUN_CTX = {
  csrfToken: "DRY_RUN_CSRF_PLACEHOLDER",
  ownUrl: "https://book.dmm.co.jp/basket/",
} as const;

export const ALL_SITES: CartSource[] = [
  "dlsite",
  "fanza-doujin",
  "fanza-books",
];
