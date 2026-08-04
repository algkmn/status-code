import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = await readFile(new URL("../content.js", import.meta.url), "utf8");

function loadContentScript({
  readyState = "complete",
  statusCode = 200,
  navigationEntries = null,
  performanceThrows = false,
  sendMessageRejects = false
} = {}) {
  const messages = [];
  const windowListeners = new Map();
  let runtimeListener;
  const browser = {
    runtime: {
      onMessage: {
        addListener(listener) {
          runtimeListener = listener;
        }
      },
      async sendMessage(message) {
        messages.push(message);

        if (sendMessageRejects) {
          throw new Error("background unavailable");
        }
      }
    }
  };
  const document = { readyState };
  const performance = {
    getEntriesByType(type) {
      if (performanceThrows) {
        throw new Error("navigation timing unavailable");
      }

      return type === "navigation"
        ? navigationEntries ?? [{ responseStatus: statusCode }]
        : [];
    }
  };
  const window = {
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    }
  };
  const context = vm.createContext({
    browser,
    document,
    Number,
    performance,
    window
  });

  new vm.Script(source, {
    filename: fileURLToPath(new URL("../content.js", import.meta.url))
  }).runInContext(context);

  return { messages, runtimeListener, windowListeners };
}

test("the navigation timing status is reported after a completed load", () => {
  const { messages } = loadContentScript({ statusCode: 200 });

  assert.equal(messages.length, 1);
  assert.deepEqual({ ...messages[0] }, {
    type: "navigation-status",
    statusCode: 200
  });
});

test("the highest supported status code is reported", () => {
  const { messages } = loadContentScript({ statusCode: 599 });

  assert.equal(messages.at(-1).statusCode, 599);
});

test("a string response status is converted to a number", () => {
  const { messages } = loadContentScript({ statusCode: "204" });

  assert.equal(messages.at(-1).statusCode, 204);
});

test("only the first navigation entry is used", () => {
  const { messages } = loadContentScript({
    navigationEntries: [{ responseStatus: 201 }, { responseStatus: 503 }]
  });

  assert.equal(messages.at(-1).statusCode, 201);
});

test("missing navigation timing produces no message", () => {
  const { messages } = loadContentScript({ navigationEntries: [] });

  assert.deepEqual(messages, []);
});

test("navigation timing failures are ignored without throwing", () => {
  const { messages } = loadContentScript({ performanceThrows: true });

  assert.deepEqual(messages, []);
});

test("pageshow reports the status again after a back-forward cache restore", () => {
  const { messages, windowListeners } = loadContentScript({ statusCode: 203 });

  windowListeners.get("pageshow")({ persisted: true });

  assert.equal(messages.length, 2);
  assert.equal(messages.at(-1).statusCode, 203);
});

test("the initial pageshow event does not duplicate the load report", () => {
  const { messages, windowListeners } = loadContentScript({ statusCode: 206 });
  const pageshow = windowListeners.get("pageshow");

  pageshow({ persisted: false });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].statusCode, 206);
});

test("the background can request a fresh navigation timing report", () => {
  const { messages, runtimeListener } = loadContentScript({ statusCode: 204 });

  runtimeListener({ type: "report-navigation-status" });

  assert.equal(messages.length, 2);
  assert.equal(messages.at(-1).statusCode, 204);
});

test("unrelated runtime messages do not trigger a report", () => {
  const { messages, runtimeListener } = loadContentScript({ statusCode: 200 });

  runtimeListener({ type: "other-message" });

  assert.equal(messages.length, 1);
});

test("a rejected background message is safely ignored", async () => {
  const { messages } = loadContentScript({ statusCode: 200, sendMessageRejects: true });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(messages.length, 1);
});

test("invalid navigation status values are ignored", () => {
  const { messages } = loadContentScript({ statusCode: 0 });

  assert.deepEqual(messages, []);
});

test("a loading document waits for the load event", () => {
  const { messages, windowListeners } = loadContentScript({
    readyState: "loading",
    statusCode: 201
  });

  assert.deepEqual(messages, []);
  windowListeners.get("load")();
  assert.equal(messages.at(-1).statusCode, 201);
});

test("an interactive document also waits for the load event", () => {
  const { messages, windowListeners } = loadContentScript({
    readyState: "interactive",
    statusCode: 202
  });

  assert.deepEqual(messages, []);
  windowListeners.get("load")();
  assert.equal(messages.at(-1).statusCode, 202);
});

test("navigation reports do not duplicate the page URL in message data", () => {
  const { messages } = loadContentScript({ statusCode: 203 });

  assert.equal(Object.hasOwn(messages.at(-1), "url"), false);
});
