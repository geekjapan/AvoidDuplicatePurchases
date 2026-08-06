export interface FanzaDoujinItem {
  contentId: string;
  productId?: string;
  title: string;
  makerName?: string;
  genre?: string;
  imageSrc?: string;
}

export interface FanzaDoujinParsedListing {
  cid: string;
  title: string;
  maker: string | null;
  seriesId: null;
  imageUrl: string | null;
  purchasedAt: string | null;
  purchasedAtPrecision: "day";
  rawJson: string;
}
