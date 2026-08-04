import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as fontkit from "fontkit";

const rootDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultOutputDirectory = join(rootDirectory, "icons", "status");
const fontPath = join(rootDirectory, "assets", "fonts", "RobotoCondensed[wght].ttf");
const font = fontkit.openSync(fontPath).getVariation({ wght: 700 });

const colors = Object.freeze({
  1: "#FFD966",
  2: "#70AD47",
  3: "#A855F7",
  4: "#FF0000",
  5: "#ED7D31"
});

const canvasSize = 64;
const maximumTextWidth = 60;
const maximumTextHeight = 33;
const lineWidth = 8;
const lineTop = 6;
const lineBottom = 58;
const maximumConcurrentWrites = 32;
const themeStyle =
  "<style>.status-text{fill:#000}@media(prefers-color-scheme:dark){.status-text{fill:#fff}}</style>";

function formatNumber(value) {
  return Number(value.toFixed(3));
}

function createTextGeometry(text) {
  const run = font.layout(text);
  const tracking = /^\d+$/.test(text) ? -64 : 0;
  let cursorX = 0;
  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;
  const glyphs = [];

  for (let index = 0; index < run.glyphs.length; index += 1) {
    const glyph = run.glyphs[index];
    const position = run.positions[index];
    const glyphX = cursorX + position.xOffset;
    const glyphY = position.yOffset;
    const bounds = glyph.bbox;

    glyphs.push({ glyph, x: glyphX, y: glyphY });
    minimumX = Math.min(minimumX, glyphX + bounds.minX);
    minimumY = Math.min(minimumY, glyphY + bounds.minY);
    maximumX = Math.max(maximumX, glyphX + bounds.maxX);
    maximumY = Math.max(maximumY, glyphY + bounds.maxY);
    cursorX += position.xAdvance + (index < run.glyphs.length - 1 ? tracking : 0);
  }

  const sourceWidth = maximumX - minimumX;
  const sourceHeight = maximumY - minimumY;
  const scale = Math.min(maximumTextWidth / sourceWidth, maximumTextHeight / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const left = (canvasSize - renderedWidth) / 2;
  const top = (canvasSize - renderedHeight) / 2;
  const transformX = left - minimumX * scale;
  const transformY = top + maximumY * scale;
  const pathData = glyphs
    .map(({ glyph, x, y }) =>
      glyph.path
        .transform(scale, 0, 0, -scale, transformX + x * scale, transformY + y * scale)
        .toSVG()
    )
    .join("");

  return {
    pathData,
    left: formatNumber(left),
    right: formatNumber(left + renderedWidth)
  };
}

function createLineMarkup(color, left, right) {
  const halfLineWidth = lineWidth / 2;
  const start = formatNumber(left + halfLineWidth);
  const end = formatNumber(right - halfLineWidth);

  return `<path d="M${start} ${lineTop}H${end}M${start} ${lineBottom}H${end}" fill="none" stroke="${color}" stroke-width="${lineWidth}" stroke-linecap="round"/>`;
}

function createStatusIcon(text, color) {
  const geometry = createTextGeometry(text);
  const lines = createLineMarkup(color, geometry.left, geometry.right);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${themeStyle}${lines}<path class="status-text" d="${geometry.pathData}"/></svg>\n`;
}

function createPendingIcon() {
  const left = 2;
  const right = 62;
  const lines = createLineMarkup("#686D76", left, right);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${themeStyle}${lines}<g class="status-text"><circle cx="6" cy="32" r="4"/><circle cx="32" cy="32" r="4"/><circle cx="58" cy="32" r="4"/></g></svg>\n`;
}

export async function generateIcons(targetDirectory = defaultOutputDirectory) {
  const outputDirectory = resolve(targetDirectory);
  const rootPrefix = rootDirectory.endsWith(sep) ? rootDirectory : `${rootDirectory}${sep}`;

  if (!outputDirectory.startsWith(rootPrefix) || basename(outputDirectory) !== "status") {
    throw new Error("The generated icon directory must be a project-local directory named status");
  }

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const iconFiles = [];

  for (let code = 100; code <= 599; code += 1) {
    const color = colors[Math.trunc(code / 100)];

    if (color) {
      iconFiles.push({
        content: createStatusIcon(String(code), color),
        path: join(outputDirectory, `${code}.svg`)
      });
    }
  }

  iconFiles.push(
    {
      content: createStatusIcon("ERR", "#5B616B"),
      path: join(outputDirectory, "error.svg")
    },
    {
      content: createPendingIcon(),
      path: join(outputDirectory, "pending.svg")
    }
  );

  for (let index = 0; index < iconFiles.length; index += maximumConcurrentWrites) {
    const batch = iconFiles.slice(index, index + maximumConcurrentWrites);
    await Promise.all(batch.map((file) => writeFile(file.path, file.content)));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateIcons(process.argv[2] ?? defaultOutputDirectory);
}
