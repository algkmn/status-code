import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateIcons } from "./generate-icons.mjs";

export const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
export const extensionDirectory = join(rootDirectory, "build", "extension");
export const runtimeFiles = Object.freeze([
  "LICENSE",
  "background.js",
  "content.js",
  "icons/extension.svg",
  "manifest.json"
]);

export async function prepareExtension() {
  await rm(extensionDirectory, { recursive: true, force: true });
  await mkdir(extensionDirectory, { recursive: true });

  for (const path of runtimeFiles) {
    const destination = join(extensionDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(rootDirectory, path), destination);
  }

  await generateIcons(join(extensionDirectory, "icons", "status"));
  return extensionDirectory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepareExtension();
}
