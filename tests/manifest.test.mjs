import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8")
);

test("manifest identifies the StatusCode release correctly", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "StatusCode");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(
    manifest.description,
    "See the current page's HTTP status code instantly in the Firefox toolbar."
  );
  assert.equal(manifest.author, "Ali Gökmen");
  assert.equal(manifest.homepage_url, "https://github.com/algkmn/status-code");
  assert.equal(manifest.incognito, "not_allowed");
});

test("manifest provides toolbar icons and a waiting title at every required size", () => {
  assert.deepEqual(manifest.action.default_icon, {
    16: "icons/status/pending.svg",
    32: "icons/status/pending.svg",
    64: "icons/status/pending.svg"
  });
  assert.equal(manifest.action.default_area, "navbar");
  assert.equal(manifest.action.default_title, "Waiting for an HTTP status code");
});

test("manifest restricts the content script to top-level HTTP pages", () => {
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["content.js"],
      run_at: "document_idle",
      all_frames: false
    }
  ]);
});

test("manifest declares the required permissions and host scope", () => {
  assert.deepEqual(manifest.permissions, ["storage", "webNavigation", "webRequest"]);
  assert.deepEqual(manifest.host_permissions, ["http://*/*", "https://*/*"]);
});

test("manifest includes stable Firefox identity and data collection declarations", () => {
  assert.equal(manifest.browser_specific_settings.gecko.id, "http-status-code@algkmn.dev");
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "142.0");
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, {
    required: ["none"]
  });
  assert.equal(manifest.browser_specific_settings.gecko_android, undefined);
});
