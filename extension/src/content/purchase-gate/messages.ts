import type { GateSurface } from "./types.js";

/** User-visible reason for blocking purchase progression (Japanese UI). */
export function gateReasonMessage(surface: GateSurface): string {
  switch (surface) {
    case "immediate_buy":
      return "確定重複のため即購入できません。カートに入れることはできます。保有ライブラリを訂正するか、購入を中止してください。";
    case "cart":
      return "カートに確定重複の商品が残っているため購入を進められません。該当行を削除するか、保有ライブラリを訂正してください。";
    case "purchase_progress":
      return "確定重複の商品がカートに残っているため購入を完了できません。カートに戻り該当商品を削除するか、保有ライブラリを訂正してください。";
  }
}
