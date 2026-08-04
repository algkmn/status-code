import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getSha256, listRelativeFiles, writeArchive } from "./archive-utils.mjs";
import { extensionDirectory, prepareExtension, rootDirectory } from "./prepare-extension.mjs";

const manifest = JSON.parse(await readFile(join(rootDirectory, "manifest.json"), "utf8"));
const outputPath = join(rootDirectory, "dist", `statuscode-${manifest.version}.zip`);

await prepareExtension();
const files = await listRelativeFiles(extensionDirectory);
const archive = await writeArchive(extensionDirectory, files, outputPath);

console.log(`${outputPath}\nSHA-256 ${getSha256(archive)}`);
