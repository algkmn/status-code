import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";

const iconDirectory = new URL("../icons/status/", import.meta.url);
const statusColors = Object.freeze({
  1: "#FFD966",
  2: "#70AD47",
  3: "#A855F7",
  4: "#FF0000",
  5: "#ED7D31"
});

const iconNames = (await readdir(iconDirectory)).sort();
const numericNames = iconNames.filter((name) => /^\d{3}\.svg$/.test(name));

test("the build output contains every HTTP status icon", () => {
  assert.equal(numericNames.length, 500);

  const expectedNames = Array.from(
    { length: 500 },
    (_, index) => `${String(index + 100).padStart(3, "0")}.svg`
  );
  assert.deepEqual(numericNames, expectedNames);
  assert.ok(iconNames.includes("pending.svg"));
  assert.ok(iconNames.includes("error.svg"));
});

test("status icons use theme-aware vector text without external resources", async () => {
  const svg = await readFile(new URL("200.svg", iconDirectory), "utf8");

  assert.match(svg, /<svg[^>]+viewBox="0 0 64 64"/);
  assert.match(svg, /prefers-color-scheme:dark/);
  assert.match(svg, /\.status-text\{fill:#000\}/);
  assert.match(svg, /\.status-text\{fill:#fff\}/);
  assert.match(svg, /class="status-text"/);
  assert.doesNotMatch(svg, /<text\b/);
  assert.doesNotMatch(svg, /(?:href|xlink:href)="(?:https?:|data:)/);
});

test("each numeric icon uses the correct response-class line color", async () => {
  for (const name of numericNames) {
    const svg = await readFile(new URL(name, iconDirectory), "utf8");
    const color = statusColors[Math.trunc(Number(name.slice(0, 3)) / 100)];

    assert.match(svg, new RegExp(`stroke="${color}"`), name);
    assert.match(svg, /stroke-width="8"/, name);
    assert.match(svg, /stroke-linecap="round"/, name);
  }
});

test("waiting and error icons keep their neutral line colors and theme text", async () => {
  const pending = await readFile(new URL("pending.svg", iconDirectory), "utf8");
  const error = await readFile(new URL("error.svg", iconDirectory), "utf8");

  assert.match(pending, /stroke="#686D76"/);
  assert.match(pending, /<circle cx="6" cy="32" r="4"\/>/);
  assert.match(pending, /<circle cx="32" cy="32" r="4"\/>/);
  assert.match(pending, /<circle cx="58" cy="32" r="4"\/>/);
  assert.match(error, /stroke="#5B616B"/);
  assert.match(error, /class="status-text"/);
});
