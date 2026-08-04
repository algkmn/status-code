import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
const content = await readFile(new URL("../content.js", import.meta.url), "utf8");
const license = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
const ci = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const codeql = await readFile(new URL("../.github/workflows/codeql.yml", import.meta.url), "utf8");
const dependabot = await readFile(new URL("../.github/dependabot.yml", import.meta.url), "utf8");
const lockfile = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url), "utf8")
);

test("runtime code contains no remote execution or active network primitives", () => {
  const runtime = `${background}\n${content}`;

  assert.doesNotMatch(runtime, /\beval\s*\(/);
  assert.doesNotMatch(runtime, /\bFunction\s*\(/);
  assert.doesNotMatch(runtime, /\bfetch\s*\(/);
  assert.doesNotMatch(runtime, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(runtime, /\bWebSocket\b/);
  assert.doesNotMatch(runtime, /\.innerHTML\s*=/);
  assert.doesNotMatch(runtime, /\bimport\s*\(/);
});

test("dependency lock records integrity and has no install scripts", () => {
  const dependencies = Object.entries(lockfile.packages).filter(([path]) => path);

  assert.ok(dependencies.length > 0);
  for (const [path, dependency] of dependencies) {
    assert.equal(typeof dependency.version, "string", path);
    assert.equal(typeof dependency.resolved, "string", path);
    assert.match(dependency.integrity, /^sha512-/, path);
    assert.notEqual(dependency.hasInstallScript, true, path);
  }
});

test("GitHub Actions use immutable full-length commit references", () => {
  const workflows = `${ci}\n${codeql}`;
  const actionReferences = [...workflows.matchAll(/^\s*uses:\s*[^@\s]+@([^\s]+)$/gm)]
    .map((match) => match[1]);

  assert.ok(actionReferences.length >= 5);
  assert.equal(actionReferences.every((reference) => /^[a-f0-9]{40}$/.test(reference)), true);
  assert.match(ci, /permissions:\n {2}contents: read/);
  assert.match(ci, /npm audit --audit-level=high/);
  assert.match(codeql, /security-events: write/);
});

test("Dependabot monitors npm and GitHub Actions", () => {
  assert.match(dependabot, /package-ecosystem: npm/);
  assert.match(dependabot, /package-ecosystem: github-actions/);
});

test("the repository includes the complete MPL 2.0 license", () => {
  assert.match(license, /^Mozilla Public License Version 2\.0/);
  assert.match(license, /10\. Versions of the License/);
  assert.match(license, /Exhibit B - "Incompatible With Secondary Licenses" Notice/);
  assert.ok(license.length > 15_000);
});
