import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const metadata = JSON.parse(
  await readFile(new URL("../amo-metadata.json", import.meta.url), "utf8")
);
const manifest = JSON.parse(
  await readFile(new URL("../manifest.json", import.meta.url), "utf8")
);
const packageData = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);

test("AMO metadata contains the required English listing fields", () => {
  assert.deepEqual(Object.keys(metadata.name), ["en-US"]);
  assert.deepEqual(Object.keys(metadata.summary), ["en-US"]);
  assert.deepEqual(Object.keys(metadata.description), ["en-US"]);
  assert.equal(metadata.name["en-US"], manifest.name);
  assert.ok(metadata.summary["en-US"].length > 0);
  assert.ok(metadata.summary["en-US"].length <= 250);
  assert.ok(metadata.description["en-US"].includes("StatusCode"));
  assert.deepEqual(metadata.categories, ["web-development"]);
  assert.equal(metadata.version.license, "MPL-2.0");
  assert.match(metadata.description["en-US"], /one-way URL hashes/);
  assert.match(metadata.description["en-US"], /Private browsing is not supported/);
});

test("AMO metadata contains approved support and release information", () => {
  assert.equal(metadata.homepage["en-US"], "https://github.com/algkmn/status-code");
  assert.equal(metadata.support_email["en-US"], "algkmn@gmail.com");
  assert.equal(metadata.support_url["en-US"], "https://github.com/algkmn/status-code/issues");
  assert.ok(metadata.version.release_notes["en-US"].includes("Initial release"));
  assert.ok(metadata.version.approval_notes.includes("http://*/* and https://*/*"));
  assert.ok(metadata.version.approval_notes.includes("incognito: not_allowed"));
  assert.ok(metadata.version.approval_notes.includes("SHA-256 URL hashes"));
});

test("package and manifest versions stay aligned", () => {
  assert.equal(packageData.name, "status-code");
  assert.equal(packageData.version, manifest.version);
  assert.equal(packageData.license, "MPL-2.0");
  assert.equal(packageData.author.name, "Ali Gökmen");
  assert.equal(packageData.repository.url, "git+https://github.com/algkmn/status-code.git");
  assert.equal(packageData.packageManager, "npm@11.9.0");
  assert.deepEqual(packageData.engines, {
    node: "24.14.x",
    npm: "11.9.x"
  });
  assert.equal(
    Object.values(packageData.devDependencies).every((version) => /^\d+\.\d+\.\d+$/.test(version)),
    true
  );
});
