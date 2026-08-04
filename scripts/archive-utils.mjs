import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import JSZip from "jszip";

const archiveDate = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

function normalizeArchivePath(value) {
  const path = value.split(sep).join("/");
  const segments = path.split("/");

  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Unsafe archive path: ${value}`);
  }

  return path;
}

export async function listRelativeFiles(directory) {
  const rootDirectory = resolve(directory);
  const files = [];

  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });

    for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
      const absolutePath = join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(normalizeArchivePath(relative(rootDirectory, absolutePath)));
      } else {
        throw new Error(`Unsupported archive entry: ${absolutePath}`);
      }
    }
  }

  await visit(rootDirectory);
  return files.sort();
}

export async function createArchiveBuffer(sourceDirectory, relativePaths) {
  const rootDirectory = resolve(sourceDirectory);
  const paths = [...new Set(relativePaths ?? await listRelativeFiles(rootDirectory))]
    .map(normalizeArchivePath)
    .sort();
  const zip = new JSZip();
  const expectedPrefix = rootDirectory.endsWith(sep) ? rootDirectory : `${rootDirectory}${sep}`;

  for (const path of paths) {
    const absolutePath = resolve(rootDirectory, ...path.split("/"));

    if (!absolutePath.startsWith(expectedPrefix)) {
      throw new Error(`Archive path escapes the source directory: ${path}`);
    }

    const entry = await lstat(absolutePath);

    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Archive source must be a regular file: ${path}`);
    }

    zip.file(path, await readFile(absolutePath), {
      createFolders: false,
      date: archiveDate,
      unixPermissions: 0o100644
    });
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "UNIX",
    streamFiles: false
  });
}

export async function writeArchive(sourceDirectory, relativePaths, outputPath) {
  const buffer = await createArchiveBuffer(sourceDirectory, relativePaths);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  return buffer;
}

export function getSha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
