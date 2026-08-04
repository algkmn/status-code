import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSha256, writeArchive } from "./archive-utils.mjs";
import { sourceFiles } from "./source-files.mjs";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(rootDirectory, "manifest.json"), "utf8"));
const outputPath = join(rootDirectory, "dist", `statuscode-${manifest.version}-source.zip`);
const archive = await writeArchive(rootDirectory, sourceFiles, outputPath);

console.log(`${outputPath}\nSHA-256 ${getSha256(archive)}`);
