import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transportFailureMessage } from "./popup.js";

describe("popup transport failure messaging", () => {
  it("maps runtime transport rejections to a local recoverable error string", () => {
    const message = transportFailureMessage("Amazon Kindle");
    assert.match(message, /Amazon Kindle 同期失敗/);
    assert.match(message, /ローカルサーバーに接続できません|同期に失敗/);
    // Must not leave the UI stuck on the in-progress wording.
    assert.doesNotMatch(message, /同期中/);
  });
});
