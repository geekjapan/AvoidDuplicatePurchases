/**
 * Title and maker normalization (Issue #7 / docs/spec.md §5).
 * Layer order: L1 → L2 → L5 → L3 → L4.
 */
/** L1: NFKC + lowercase + whitespace collapse. */
export declare function l1(s: string): string;
export declare const BRACKETS: RegExp;
/**
 * Rejected rule: strip all brackets. Kept for regression self-check only.
 * Bracket content often carries series identity (performer, edition) in doujin audio.
 */
export declare function stripAllBrackets(s: string): string;
/** L2: remove store edition markers only; preserve identifying bracket content. */
export declare function l2(s: string): string;
/** L3: drop symbols and whitespace; keep letters and digits. */
export declare function l3(s: string): string;
/** L4: katakana→hiragana, long-vowel and small-kana normalization. */
export declare function l4(s: string): string;
/** L5: strip volume/chapter markers before symbol removal eats parenthesized numbers. */
export declare function l5(s: string): string;
/** Stack normalization layers. `level` is 1..5 per spec. */
export declare function key(title: string, level: number): string;
/** Title match_key uses full L1–L5 stack (level 5). */
export declare function titleMatchKey(title: string): string;
/** Maker match_key uses L1–L4 (level 4). */
export declare function makerMatchKey(maker: string | null | undefined): string;
/** Bigram Dice coefficient for candidate-queue scoring (spec §5). */
export declare function dice(a: string, b: string): number;
/** Regression guard: blanket bracket removal must not become the default path. */
export declare function assertNormalizationSelfCheck(): void;
//# sourceMappingURL=normalize.d.ts.map