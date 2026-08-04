import type { CartRequestContext, CartSource } from "@adp/shared";

export function readCartContext(source: CartSource, doc: Document): CartRequestContext {
  switch (source) {
    case "dlsite":
      return {};
    case "fanza-doujin": {
      const token = doc
        .querySelector<HTMLMetaElement>('meta[name="csrf-token"]')
        ?.content?.trim();
      if (!token) {
        throw new Error("fanza-doujin cart requires csrf-token meta");
      }
      return { csrfToken: token };
    }
    case "fanza-books":
      return { ownUrl: doc.location?.href ?? "https://book.dmm.co.jp/basket/" };
  }
}
