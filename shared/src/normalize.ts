/**
 * Title and maker normalization (Issue #7 / docs/spec.md §5).
 * Layer order: L1 → L2 → L5 → L3 → L4.
 */

/** L1: NFKC + lowercase + whitespace collapse. */
export function l1(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export const BRACKETS =
  /[【[（(〔《「『][^】\]）)〕》」』]{0,30}[】\]）)〕》」』]/gu;

/**
 * Rejected rule: strip all brackets. Kept for regression self-check only.
 * Bracket content often carries series identity (performer, edition) in doujin audio.
 */
export function stripAllBrackets(s: string): string {
  const stripped = s.replace(BRACKETS, " ").replace(/\s+/g, " ").trim();
  return stripped.length ? stripped : s;
}

/** Store-specific edition markers inside brackets — not free-trial or content tags. */
const STORE_MARKER =
  /^(fanza|dlsite|dmm)?\s*(限定版|限定|専売|先行版|独占)$|^dl版$|^電子(書籍)?版$/i;

/** L2: remove store edition markers only; preserve identifying bracket content. */
export function l2(s: string): string {
  const stripped = s
    .replace(BRACKETS, (m) => (STORE_MARKER.test(m.slice(1, -1).trim()) ? " " : m))
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length ? stripped : s;
}

/** L3: drop symbols and whitespace; keep letters and digits. */
export function l3(s: string): string {
  return s.replace(/[^\p{L}\p{N}]/gu, "");
}

/** L4: katakana→hiragana, long-vowel and small-kana normalization. */
export function l4(s: string): string {
  let t = s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  t = t.replace(/[ー―‐−–—]/g, "");
  t = t.replace(/[ぁぃぅぇぉっゃゅょゎ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 1),
  );
  t = t.replace(/ゔ/g, "う").replace(/[ぢ]/g, "じ").replace(/[づ]/g, "ず");
  return t;
}

/** L5: strip volume/chapter markers before symbol removal eats parenthesized numbers. */
export function l5(s: string): string {
  return s
    .replace(/[(（[【]\s*\d{1,3}\s*[)）\]】]/g, "")
    .replace(/第?\d{1,3}(巻|話|章|部|集|冊)/g, "")
    .replace(/vol\.?\s*\d{1,3}/gi, "")
    .replace(/その\d{1,3}/g, "")
    .replace(/[上中下前後]巻/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stack normalization layers. `level` is 1..5 per spec. */
export function key(title: string, level: number): string {
  let t = l1(title);
  if (level >= 2) t = l2(t);
  if (level >= 5) t = l5(t);
  if (level >= 3) t = l3(t);
  if (level >= 4) t = l4(t);
  return t;
}

/** Title match_key uses full L1–L5 stack (level 5). */
export function titleMatchKey(title: string): string {
  return key(title, 5);
}

/** Maker match_key uses L1–L4 (level 4). */
export function makerMatchKey(maker: string | null | undefined): string {
  if (!maker) return "";
  return key(maker, 4);
}

/** Bigram Dice coefficient for candidate-queue scoring (spec §5). */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

/**
 * Regression guard for the production key path (titleMatchKey / key L1–L5).
 * Distinct identifying brackets must survive; this must pass on the current
 * implementation and fail only if blanket bracket removal re-enters that path.
 */
export function assertNormalizationSelfCheck(): void {
  const a = "作品【演者A】";
  const b = "作品【演者B】";
  if (titleMatchKey(a) === titleMatchKey(b) || key(a, 5) === key(b, 5)) {
    throw new Error(
      "normalization regression: distinct bracket content collapsed on production key path",
    );
  }
}
