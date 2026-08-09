import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { librarySyncError, transportFailureMessage } from "./popup.js";

describe("popup transport failure messaging", () => {
  it("maps runtime transport rejections to a local recoverable error string", () => {
    const message = transportFailureMessage("Amazon Kindle");
    assert.match(message, /Amazon Kindle 同期失敗/);
    assert.match(message, /ローカルサーバーに接続できません|同期に失敗/);
    // Must not leave the UI stuck on the in-progress wording.
    assert.doesNotMatch(message, /同期中/);
  });
});

describe("librarySyncError mapping", () => {
  it("maps known library sync and protocol codes to stable Japanese messages", () => {
    assert.equal(librarySyncError("network"), "ローカルサーバーに接続できません");
    assert.equal(librarySyncError("protocol"), "サーバー応答の形式が不正です");
    assert.equal(librarySyncError("library_page_url_invalid"), "ライブラリページのURLが不正です");
    assert.equal(librarySyncError("library_max_pages_exceeded"), "ページ数が上限を超えました");
    assert.equal(librarySyncError("library_rematch_failed"), "蔵書の再突合に失敗しました");
    assert.equal(librarySyncError("library_mark_synced_failed"), "同期完了の記録に失敗しました");
    assert.equal(librarySyncError("library_unknown_provider"), "未対応のプロバイダです");
    assert.equal(librarySyncError("library_no_tab"), "同期に使うタブを開けませんでした");
    assert.equal(librarySyncError("library_read_failed"), "ライブラリ画面の読み取りに失敗しました");
    assert.equal(
      librarySyncError("library_readiness_timeout"),
      "ライブラリ画面の準備が完了しませんでした",
    );
    assert.equal(
      librarySyncError("library_login_required"),
      "ログインが必要です（ライブラリ画面に到達できませんでした）",
    );
    assert.equal(
      librarySyncError("library_reader_unregistered"),
      "ライブラリ読み取り機能が未登録です",
    );
    assert.equal(librarySyncError("library_batch_too_large"), "1ページの件数が上限を超えました");
  });

  it("fail-closes unknown and empty errors without exposing internal strings", () => {
    assert.equal(librarySyncError(undefined), "同期に失敗しました");
    assert.equal(librarySyncError(""), "同期に失敗しました");
    assert.equal(librarySyncError("totally_unknown_internal_code"), "同期に失敗しました");
    assert.equal(librarySyncError("library_secret_leak"), "同期に失敗しました");
    assert.doesNotMatch(librarySyncError("totally_unknown_internal_code"), /totally_unknown/);
    assert.doesNotMatch(librarySyncError("library_secret_leak"), /library_secret_leak/);
  });
});
