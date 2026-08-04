import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import {
  createArchiveBuffer,
  getSha256,
  listRelativeFiles
} from "./archive-utils.mjs";
import { extensionDirectory, rootDirectory } from "./prepare-extension.mjs";
import { sourceFiles } from "./source-files.mjs";

const manifest = JSON.parse(await readFile(join(rootDirectory, "manifest.json"), "utf8"));
const extensionPath = join(rootDirectory, "dist", `statuscode-${manifest.version}.zip`);
const sourcePath = join(rootDirectory, "dist", `statuscode-${manifest.version}-source.zip`);

function assertSafePaths(paths) {
  for (const path of paths) {
    const segments = path.split("/");
    assert.equal(path.startsWith("/"), false, path);
    assert.equal(path.includes("\\"), false, path);
    assert.equal(segments.some((segment) => !segment || segment === "." || segment === ".."), false, path);
  }
}

async function loadArchive(path) {
  const buffer = await readFile(path);
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const entries = Object.values(zip.files);

  assert.equal(entries.every((entry) => !entry.dir), true);
  assert.equal(
    entries.every((entry) => !entry.unsafeOriginalName || entry.unsafeOriginalName === entry.name),
    true
  );

  const paths = entries.map((entry) => entry.name).sort();
  assertSafePaths(paths);
  assert.equal(new Set(paths).size, paths.length);
  return { buffer, paths, zip };
}

const extension = await loadArchive(extensionPath);
const expectedExtensionPaths = await listRelativeFiles(extensionDirectory);
assert.deepEqual(extension.paths, expectedExtensionPaths);

for (const path of expectedExtensionPaths) {
  const archived = await extension.zip.file(path).async("nodebuffer");
  const staged = await readFile(join(extensionDirectory, ...path.split("/")));
  assert.deepEqual(archived, staged, path);
}

const archivedManifest = JSON.parse(await extension.zip.file("manifest.json").async("string"));
assert.equal(archivedManifest.version, manifest.version);
assert.equal(extension.zip.file("package.json"), null);
assert.deepEqual(extension.buffer, await createArchiveBuffer(extensionDirectory, expectedExtensionPaths));

const source = await loadArchive(sourcePath);
assert.deepEqual(source.paths, [...sourceFiles].sort());
assert.deepEqual(source.buffer, await createArchiveBuffer(rootDirectory, sourceFiles));

console.log(`Extension SHA-256 ${getSha256(extension.buffer)}`);
console.log(`Source SHA-256 ${getSha256(source.buffer)}`);
