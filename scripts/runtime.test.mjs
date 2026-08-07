import assert from "node:assert/strict";
import test from "node:test";
import { extensionIdFromConfig, isValidExtensionId, updateEnvFile } from "./runtime.mjs";

test("validates Chrome extension IDs", () => {
  assert.equal(isValidExtensionId("a".repeat(32)), true);
  assert.equal(isValidExtensionId("p".repeat(32)), true);
  assert.equal(isValidExtensionId("a".repeat(31)), false);
  assert.equal(isValidExtensionId("q".repeat(32)), false);
  assert.equal(isValidExtensionId("A".repeat(32)), false);
});

test("updates only the extension origin in reusable config", () => {
  const id = "b".repeat(32);
  const config = [
    "# Keep the existing database path",
    "ADP_DB_PATH=/tmp/keep-this.sqlite",
    "ADP_EXTENSION_ORIGIN=chrome-extension-old",
    "",
  ].join("\n");
  const updated = updateEnvFile(config, "ADP_EXTENSION_ORIGIN", `chrome-extension://${id}`);
  assert.match(updated, /ADP_DB_PATH=\/tmp\/keep-this\.sqlite/);
  assert.equal(extensionIdFromConfig(updated), id);
  assert.equal((updated.match(/ADP_EXTENSION_ORIGIN=/g) ?? []).length, 1);
});
