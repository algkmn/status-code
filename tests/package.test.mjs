import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { createArchiveBuffer, listRelativeFiles } from "../scripts/archive-utils.mjs";
import {
  extensionDirectory,
  prepareExtension,
  rootDirectory,
  runtimeFiles
} from "../scripts/prepare-extension.mjs";
import { sourceFiles } from "../scripts/source-files.mjs";

test("archive generation is byte-for-byte deterministic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statuscode-archive-"));

  try {
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "z.txt"), "last\n");
    await writeFile(join(directory, "nested", "a.txt"), "first\n");
    const paths = await listRelativeFiles(directory);
    const first = await createArchiveBuffer(directory, paths);
    const second = await createArchiveBuffer(directory, [...paths].reverse());
    const zip = await JSZip.loadAsync(first, { checkCRC32: true });

    assert.deepEqual(first, second);
    assert.deepEqual(Object.keys(zip.files).sort(), ["nested/a.txt", "z.txt"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("archive generation rejects paths outside its source directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "statuscode-unsafe-"));

  try {
    await assert.rejects(
      createArchiveBuffer(directory, ["../outside.txt"]),
      /Unsafe archive path/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("archive generation rejects symbolic links", {
  skip: process.platform === "win32"
}, async () => {
  const directory = await mkdtemp(join(tmpdir(), "statuscode-symlink-"));
  const root = join(directory, "root");

  try {
    await mkdir(root);
    await writeFile(join(directory, "outside.txt"), "private\n");
    await symlink("../outside.txt", join(root, "link.txt"));
    await assert.rejects(
      createArchiveBuffer(root, ["link.txt"]),
      /Archive source must be a regular file/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("extension staging contains only the runtime allowlist", async () => {
  await prepareExtension();
  const files = await listRelativeFiles(extensionDirectory);
  const expectedStaticFiles = [...runtimeFiles].sort();
  const statusIcons = files.filter((path) => path.startsWith("icons/status/"));

  assert.equal(statusIcons.length, 502);
  assert.deepEqual(
    files.filter((path) => !path.startsWith("icons/status/")),
    expectedStaticFiles
  );
  assert.equal(files.includes("package.json"), false);
  assert.equal(files.includes("README.md"), false);
});

test("source package allowlist is unique and complete", async () => {
  assert.equal(new Set(sourceFiles).size, sourceFiles.length);

  for (const path of sourceFiles) {
    assert.equal((await stat(join(rootDirectory, ...path.split("/")))).isFile(), true, path);
  }
});
