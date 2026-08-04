import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { TextEncoder } from "node:util";
import { fileURLToPath } from "node:url";

const calls = [];
const appliedCalls = [];
const sessionStore = {};
const tabRecords = new Map();
const tabTitles = new Map();
const titleBarriers = new Map();
const actionFailures = { icon: null, title: null };
const storageFailures = { get: null, set: null, remove: null };
const tabFailures = { get: null, create: null, sendMessage: null };
const listeners = {
  action: {},
  runtime: {},
  tabs: {},
  webNavigation: {},
  webRequest: {}
};
let defaultTitle = "";

function takeFailure(bucket, name) {
  const failure = bucket[name];

  if (!failure) {
    return;
  }

  if (Array.isArray(failure)) {
    bucket[name] = failure.length > 1 ? failure.slice(1) : null;
    throw failure[0];
  }

  bucket[name] = null;
  throw failure;
}

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function getTitleBarrierKey(tabId, title) {
  return `${tabId}:${title}`;
}

function blockTitle(tabId, title) {
  const deferred = createDeferred();
  titleBarriers.set(getTitleBarrierKey(tabId, title), deferred);
  return deferred;
}

const action = {
  onClicked: createEvent("action", "onClicked"),
  async setIcon(details) {
    calls.push(["setIcon", details]);
    takeFailure(actionFailures, "icon");
    appliedCalls.push(["setIcon", details]);
  },
  async setTitle(details) {
    calls.push(["setTitle", details]);
    takeFailure(actionFailures, "title");
    const key = getTitleBarrierKey(details.tabId, details.title);
    const barrier = titleBarriers.get(key);

    if (barrier) {
      await barrier.promise;
      if (titleBarriers.get(key) === barrier) {
        titleBarriers.delete(key);
      }
    }

    if (Number.isInteger(details.tabId)) {
      tabTitles.set(details.tabId, details.title);
    } else {
      defaultTitle = details.title;
    }

    appliedCalls.push(["setTitle", details]);
  }
};

function createEvent(group, name) {
  return {
    addListener(listener, filter) {
      listeners[group][name] = { filter, listener };
    }
  };
}

const browser = {
  action,
  runtime: {
    onMessage: createEvent("runtime", "onMessage")
  },
  storage: {
    session: {
      async get(key) {
        takeFailure(storageFailures, "get");
        const keys = Array.isArray(key) ? key : [key];

        return Object.fromEntries(
          keys
            .filter((entry) => entry in sessionStore)
            .map((entry) => [entry, sessionStore[entry]])
        );
      },
      async remove(key) {
        takeFailure(storageFailures, "remove");
        const keys = Array.isArray(key) ? key : [key];

        for (const entry of keys) {
          delete sessionStore[entry];
        }
      },
      async set(values) {
        takeFailure(storageFailures, "set");
        Object.assign(sessionStore, values);
      }
    }
  },
  tabs: {
    onActivated: createEvent("tabs", "onActivated"),
    onRemoved: createEvent("tabs", "onRemoved"),
    onUpdated: createEvent("tabs", "onUpdated"),
    async get(tabId) {
      takeFailure(tabFailures, "get");
      const tab = tabRecords.get(tabId);

      if (!tab) {
        throw new Error(`Invalid tab ID: ${tabId}`);
      }

      return tab;
    },
    async create(details) {
      takeFailure(tabFailures, "create");
      calls.push(["createTab", details]);
      appliedCalls.push(["createTab", details]);
      return { id: 99, ...details };
    },
    async sendMessage(tabId, message) {
      takeFailure(tabFailures, "sendMessage");
      calls.push(["sendMessage", { message, tabId }]);
      appliedCalls.push(["sendMessage", { message, tabId }]);
    }
  },
  webNavigation: Object.fromEntries(
    [
      "onBeforeNavigate",
      "onCommitted",
      "onDOMContentLoaded",
      "onCompleted",
      "onHistoryStateUpdated",
      "onReferenceFragmentUpdated"
    ].map((event) => [event, createEvent("webNavigation", event)])
  ),
  webRequest: {
    ...Object.fromEntries(
      [
        "onBeforeRequest",
        "onHeadersReceived",
        "onResponseStarted",
        "onCompleted",
        "onErrorOccurred"
      ].map((event) => [event, createEvent("webRequest", event)])
    )
  }
};

const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
const context = vm.createContext({
  browser,
  __testControls: {
    actionFailures,
    storageFailures,
    tabFailures,
    sessionStore
  },
  Promise,
  Number,
  Object,
  String,
  Math,
  Map,
  Date,
  URL,
  TextEncoder,
  Uint8Array,
  crypto: webcrypto
});
new vm.Script(source, {
  filename: fileURLToPath(new URL("../background.js", import.meta.url))
}).runInContext(context);
vm.runInContext(
  `globalThis.__testHooks = {
    getStatusState,
    getIconPath,
    normalizeUrl,
    isUsableTabId,
    isOpenTabId,
    isValidState,
    isFinalState,
    normalizeStoredRecord,
    getRememberedTabState,
    recordsMatch,
    findTabState,
    rememberTabState,
    renderState,
    queueRender,
    restoreTabState,
    applyWebRequestStatus,
    handleBeforeNavigation,
    handleNavigationStage,
    handleSameDocumentNavigation,
    isClosedTabError,
    getTabRecord: (tabId) => tabStateCache.get(tabId) ?? null,
    getHistory: (tabId) => [...(tabHistoryCache.get(tabId) ?? [])],
    getActiveRequest: (tabId) => activeRequests.get(tabId) ?? null,
    getCommittedNavigation: (tabId) => committedNavigations.get(tabId) ?? null,
    getNavigationToken: (tabId) => getNavigationToken(tabId),
    setActionFailure: (name, failure) => {
      __testControls.actionFailures[name] = failure;
    },
    setStorageFailure: (name, failure) => {
      __testControls.storageFailures[name] = failure;
    },
    setTabFailure: (name, failure) => {
      __testControls.tabFailures[name] = failure;
    },
    clearFailures: () => {
      Object.keys(__testControls.actionFailures).forEach((name) => {
        __testControls.actionFailures[name] = null;
      });
      Object.keys(__testControls.storageFailures).forEach((name) => {
        __testControls.storageFailures[name] = null;
      });
      Object.keys(__testControls.tabFailures).forEach((name) => {
        __testControls.tabFailures[name] = null;
      });
    },
    getSessionStore: () => ({ ...__testControls.sessionStore }),
    resetForTest: () => {
      tabStateCache.clear();
      tabHistoryCache.clear();
      activeRequests.clear();
      committedNavigations.clear();
      navigationTokens.clear();
      renderQueues.clear();
      renderVersions.clear();
      storageQueues.clear();
      tabHistoryLoadTasks.clear();
      loadedTabHistoryIds.clear();
      closedTabIds.clear();
      Object.keys(__testControls.sessionStore).forEach((key) => {
        delete __testControls.sessionStore[key];
      });
    },
    getRenderTask: (tabId) => renderQueues.get(tabId) ?? null,
    getStorageTask: (tabId) => storageQueues.get(tabId) ?? null,
    simulateRestart: () => {
      tabStateCache.clear();
      tabHistoryCache.clear();
      activeRequests.clear();
      committedNavigations.clear();
      navigationTokens.clear();
      renderQueues.clear();
      renderVersions.clear();
      storageQueues.clear();
      tabHistoryLoadTasks.clear();
      loadedTabHistoryIds.clear();
      closedTabIds.clear();
    }
  };`,
  context
);

const flush = () => new Promise((resolve) => setImmediate(resolve));

async function settle(tabId) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flush();
    const task = context.__testHooks.getRenderTask(tabId);

    if (task) {
      await task;
    }

    await flush();
    if (!context.__testHooks.getRenderTask(tabId)) {
      return;
    }
  }

  throw new Error(`Render queue did not settle for tab ${tabId}`);
}

async function settleStorage(tabId, { allowFailure = false } = {}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const task = context.__testHooks.getStorageTask(tabId);

    if (task) {
      if (allowFailure) {
        await task.catch(() => undefined);
      } else {
        await task;
      }
    }

    await flush();
    if (!context.__testHooks.getStorageTask(tabId)) {
      return;
    }
  }

  throw new Error(`Storage queue did not settle for tab ${tabId}`);
}

function setTab(tabId, url) {
  tabRecords.set(tabId, { id: tabId, url });
}

function emitWebRequest(event, details) {
  return listeners.webRequest[event].listener(details);
}

function emitWebNavigation(event, details) {
  return listeners.webNavigation[event].listener(details);
}

function resetTabAction(tabId) {
  tabTitles.delete(tabId);
}

function getEffectiveTitle(tabId) {
  return tabTitles.get(tabId) ?? defaultTitle;
}

function getCalls(method, tabId, source = calls) {
  return source.filter(
    ([callMethod, details]) => callMethod === method && details.tabId === tabId
  );
}

await flush();
calls.length = 0;
appliedCalls.length = 0;

beforeEach(() => {
  context.__testHooks.resetForTest();
  context.__testHooks.clearFailures();
  tabRecords.clear();
  tabTitles.clear();
  titleBarriers.clear();
  calls.length = 0;
  appliedCalls.length = 0;
  defaultTitle = "Waiting for an HTTP status code";
});

test("status codes use their known titles", () => {
  assert.deepEqual({ ...context.__testHooks.getStatusState(103) }, {
    text: "103",
    title: "103 Early Hints"
  });
});

test("known status titles are included in the tooltip", () => {
  assert.equal(context.__testHooks.getStatusState(418).title, "418 I'm a teapot");
  assert.equal(
    context.__testHooks.getStatusState(511).title,
    "511 Network Authentication Required"
  );
});

test("unknown valid codes fall back to the class title", () => {
  assert.equal(context.__testHooks.getStatusState(299).title, "299 Success");
});

test("invalid codes return the error state", () => {
  assert.deepEqual({ ...context.__testHooks.getStatusState(0) }, {
    text: "ERR",
    title: "No HTTP response received"
  });
});

test("clicking the icon opens the MDN status code reference", async () => {
  calls.length = 0;
  appliedCalls.length = 0;

  await listeners.action.onClicked.listener();

  assert.equal(calls.at(-1)[0], "createTab");
  assert.equal(
    calls.at(-1)[1].url,
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status"
  );
});

test("only main document requests are observed", () => {
  for (const event of [
    "onBeforeRequest",
    "onHeadersReceived",
    "onResponseStarted",
    "onCompleted",
    "onErrorOccurred"
  ]) {
    assert.deepEqual(Array.from(listeners.webRequest[event].filter.types), ["main_frame"]);
    assert.deepEqual(Array.from(listeners.webRequest[event].filter.urls), [
      "http://*/*",
      "https://*/*"
    ]);
  }
});

test("the completed response wins over the pending state", async () => {
  const tabId = 7;
  const url = "https://example.com/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "request-7",
    url
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "request-7",
    statusCode: 200,
    url
  });
  await settle(tabId);

  const titleCalls = getCalls("setTitle", tabId, appliedCalls);
  const iconCalls = getCalls("setIcon", tabId, appliedCalls);
  assert.equal(titleCalls.at(-1)[1].title, "200 OK");
  assert.equal(iconCalls.at(-1)[1].path[16], "icons/status/200.svg");
  assert.equal(iconCalls.at(-1)[1].path[32], "icons/status/200.svg");
  assert.equal(iconCalls.at(-1)[1].path[64], "icons/status/200.svg");
});

test("navigation timing supplies a status when webRequest has no result", async () => {
  const tabId = 8;
  const url = "https://fallback.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  await listeners.runtime.onMessage.listener(
    {
      type: "navigation-status",
      statusCode: 201,
      url
    },
    {
      frameId: 0,
      tab: { id: tabId },
      url
    }
  );
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "201 Created");
  assert.equal(getCalls("setTitle", tabId, appliedCalls).at(-1)[1].title, "201 Created");
});

test("webRequest remains authoritative over navigation timing", async () => {
  const tabId = 9;
  const url = "https://cached.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "request-9",
    url
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "request-9",
    statusCode: 304,
    url
  });
  await settle(tabId);
  calls.length = 0;
  appliedCalls.length = 0;

  await listeners.runtime.onMessage.listener(
    {
      type: "navigation-status",
      statusCode: 200,
      url
    },
    {
      frameId: 0,
      tab: { id: tabId },
      url
    }
  );
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "304 Not Modified");
  assert.equal(getCalls("setTitle", tabId, appliedCalls).at(-1)[1].title, "304 Not Modified");
});

test("webNavigation commit and completion reapply the navigation icon", async () => {
  const tabId = 10;
  const url = "https://reset.example/";
  setTab(tabId, url);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "request-10",
    url
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "request-10",
    statusCode: 204,
    url
  });
  await settle(tabId);

  for (const event of ["onCommitted", "onCompleted"]) {
    resetTabAction(tabId);
    assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");
    calls.length = 0;
    appliedCalls.length = 0;

    emitWebNavigation(event, {
      tabId,
      frameId: 0,
      url
    });
    await settle(tabId);

    assert.equal(getEffectiveTitle(tabId), "204 No Content");
    assert.equal(getCalls("setTitle", tabId, appliedCalls).at(-1)[1].title, "204 No Content");
    assert.equal(getCalls("setIcon", tabId, appliedCalls).length, 1);
  }
});

test("webNavigation start clears the previous document status", async () => {
  const tabId = 13;
  const oldUrl = "https://before-old.example/";
  const newUrl = "https://before-new.example/";
  setTab(tabId, oldUrl);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "request-13",
    timeStamp: 100,
    url: oldUrl
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "request-13",
    statusCode: 200,
    timeStamp: 110,
    url: oldUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "200 OK");
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebNavigation("onBeforeNavigate", {
    tabId,
    frameId: 0,
    timeStamp: Date.now() + 1_000,
    url: newUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");
  assert.equal(
    getCalls("setTitle", tabId, appliedCalls).at(-1)[1].title,
    "Waiting for an HTTP status code"
  );
});

test("a redirect with the same request ID does not return to pending", async () => {
  const tabId = 14;
  const firstUrl = "https://redirect.example/";
  const finalUrl = "https://destination.example/";
  setTab(tabId, finalUrl);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "redirect-request",
    url: firstUrl
  });
  emitWebRequest("onHeadersReceived", {
    tabId,
    requestId: "redirect-request",
    statusCode: 301,
    url: firstUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "301 Moved Permanently");
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "redirect-request",
    url: finalUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "301 Moved Permanently");
  assert.equal(getCalls("setTitle", tabId, appliedCalls).length, 0);

  emitWebRequest("onResponseStarted", {
    tabId,
    requestId: "redirect-request",
    statusCode: 200,
    url: finalUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "200 OK");
});

test("a stale request cannot overwrite a newer navigation", async () => {
  const tabId = 11;
  const oldUrl = "https://old.example/";
  const newUrl = "https://new.example/";
  setTab(tabId, newUrl);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "old-request",
    url: oldUrl
  });
  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "new-request",
    url: newUrl
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "old-request",
    statusCode: 200,
    url: oldUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");
  assert.equal(
    getCalls("setTitle", tabId, appliedCalls).some(([, details]) => details.title === "200 OK"),
    false
  );

  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "new-request",
    statusCode: 201,
    url: newUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "201 Created");
});

test("a stale request stays rejected after an event-page restart", async () => {
  const tabId = 15;
  const oldUrl = "https://restart-old.example/";
  const newUrl = "https://restart-new.example/";
  setTab(tabId, newUrl);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "restart-old-request",
    url: oldUrl
  });
  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "restart-new-request",
    url: newUrl
  });
  await settle(tabId);
  await settleStorage(tabId);
  context.__testHooks.simulateRestart();
  calls.length = 0;
  appliedCalls.length = 0;

  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "restart-old-request",
    statusCode: 200,
    url: oldUrl
  });
  await settle(tabId);

  assert.equal(
    getCalls("setTitle", tabId, appliedCalls).some(([, details]) => details.title === "200 OK"),
    false
  );

  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "restart-new-request",
    statusCode: 202,
    url: newUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "202 Accepted");
});

test("a body error does not erase an HTTP status already received", async () => {
  const tabId = 16;
  const url = "https://partial-response.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "partial-response-request",
    url
  });
  emitWebRequest("onResponseStarted", {
    tabId,
    requestId: "partial-response-request",
    statusCode: 206,
    url
  });
  await settle(tabId);
  await emitWebRequest("onErrorOccurred", {
    tabId,
    requestId: "partial-response-request",
    url
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "206 Partial Content");
});

test("a same-URL navigation rejects an old document fallback", async () => {
  const tabId = 17;
  const url = "https://same-url.example/";
  setTab(tabId, url);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "same-url-old-request",
    documentId: "old-document",
    url
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "same-url-old-request",
    statusCode: 200,
    documentId: "old-document",
    url
  });
  await settle(tabId);

  emitWebNavigation("onBeforeNavigate", {
    tabId,
    frameId: 0,
    documentId: "new-document",
    timeStamp: Date.now() + 1_000,
    url
  });
  await settle(tabId);

  await listeners.runtime.onMessage.listener(
    {
      type: "navigation-status",
      statusCode: 201,
      url
    },
    {
      documentId: "old-document",
      frameId: 0,
      tab: { id: tabId },
      url
    }
  );
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");

  await listeners.runtime.onMessage.listener(
    {
      type: "navigation-status",
      statusCode: 503,
      url
    },
    {
      documentId: "new-document",
      frameId: 0,
      tab: { id: tabId },
      url
    }
  );
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "503 Service Unavailable");
});

test("rendering is serialized when a pending update resolves late", async () => {
  const tabId = 12;
  const url = "https://race.example/";
  const pendingBarrier = blockTitle(tabId, "Waiting for an HTTP status code");
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "request-12",
    url
  });
  await flush();

  assert.equal(getCalls("setTitle", tabId).at(-1)[1].title, "Waiting for an HTTP status code");

  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "request-12",
    statusCode: 200,
    url
  });
  await flush();
  await flush();

  assert.equal(
    getCalls("setTitle", tabId).some(([, details]) => details.title === "200 OK"),
    false
  );

  pendingBarrier.resolve();
  await settle(tabId);

  const appliedTitles = getCalls("setTitle", tabId, appliedCalls).map(([, details]) => details.title);
  assert.deepEqual(appliedTitles, ["Waiting for an HTTP status code", "200 OK"]);
  assert.equal(getEffectiveTitle(tabId), "200 OK");
});

test("status state handles boundaries, strings, and invalid values", () => {
  const getStatusState = context.__testHooks.getStatusState;

  for (const code of [100, 199, 200, 299, 300, 399, 400, 499, 500, 599]) {
    const state = getStatusState(code);
    assert.equal(state.text, String(code));
    assert.match(state.title, new RegExp(`^${code} `));
  }

  assert.equal(getStatusState("404").title, "404 Not Found");

  for (const value of [99, 600, 200.5, Number.NaN, Number.POSITIVE_INFINITY, null, true, "abc"]) {
    assert.equal(getStatusState(value).text, "ERR");
  }
});

test("icon paths and URL normalization are deterministic", () => {
  const { getIconPath, normalizeUrl, isUsableTabId } = context.__testHooks;

  assert.equal(getIconPath({ text: "200" })[16], "icons/status/200.svg");
  assert.equal(getIconPath({ text: "ERR" })[32], "icons/status/error.svg");
  assert.equal(getIconPath({ text: "..." })[64], "icons/status/pending.svg");
  assert.equal(normalizeUrl("https://example.com/path#section"), "https://example.com/path");
  assert.equal(normalizeUrl("not a URL"), "not a URL");
  assert.equal(normalizeUrl(""), "");
  assert.equal(normalizeUrl(null), "");
  assert.equal(isUsableTabId(0), true);
  assert.equal(isUsableTabId(42), true);
  assert.equal(isUsableTabId(-1), false);
  assert.equal(isUsableTabId("42"), false);
});

test("web request lifecycle updates early and final response statuses", async () => {
  const tabId = 101;
  const url = "https://lifecycle.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", { tabId, requestId: "lifecycle", url });
  await settle(tabId);
  assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");

  emitWebRequest("onHeadersReceived", {
    tabId,
    requestId: "lifecycle",
    statusCode: 103,
    url
  });
  await settle(tabId);
  assert.equal(getEffectiveTitle(tabId), "103 Early Hints");

  emitWebRequest("onResponseStarted", {
    tabId,
    requestId: "lifecycle",
    statusCode: 200,
    url
  });
  await settle(tabId);
  assert.equal(getEffectiveTitle(tabId), "200 OK");

  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "lifecycle",
    statusCode: 204,
    url
  });
  await settle(tabId);
  await flush();
  assert.equal(getEffectiveTitle(tabId), "204 No Content");
  assert.equal(context.__testHooks.getActiveRequest(tabId), null);
});

test("identical response stages do not rewrite or rerender the same status", async () => {
  const tabId = 130;
  const url = "https://deduplicated-response.example/";
  setTab(tabId, url);

  emitWebRequest("onBeforeRequest", { tabId, requestId: "deduplicated", url });
  emitWebRequest("onHeadersReceived", {
    tabId,
    requestId: "deduplicated",
    statusCode: 200,
    url
  });
  await settle(tabId);
  await settleStorage(tabId);
  const record = context.__testHooks.getTabRecord(tabId);
  const historyLength = context.__testHooks.getHistory(tabId).length;
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onResponseStarted", {
    tabId,
    requestId: "deduplicated",
    statusCode: 200,
    url
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "deduplicated",
    statusCode: 200,
    url
  });
  await flush();
  await settle(tabId);

  assert.equal(context.__testHooks.getTabRecord(tabId), record);
  assert.equal(context.__testHooks.getHistory(tabId).length, historyLength);
  assert.equal(getCalls("setIcon", tabId, appliedCalls).length, 0);
  assert.equal(getCalls("setTitle", tabId, appliedCalls).length, 0);
  assert.equal(context.__testHooks.getActiveRequest(tabId), null);
});

test("repeated before-request events update the active request without resetting it", async () => {
  const tabId = 102;
  const firstUrl = "https://repeat.example/first";
  const secondUrl = "https://repeat.example/second";
  setTab(tabId, secondUrl);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "repeat",
    documentId: "document-1",
    timeStamp: 10,
    url: firstUrl
  });
  await settle(tabId);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "repeat",
    documentId: "document-2",
    timeStamp: 20,
    url: secondUrl
  });
  await settle(tabId);

  const active = context.__testHooks.getActiveRequest(tabId);
  assert.equal(active.url, secondUrl);
  assert.equal(active.documentId, "document-2");
  assert.equal(active.timeStamp, 20);
  assert.equal(getCalls("setTitle", tabId, appliedCalls).length, 1);
});

test("unknown but valid status codes use the class fallback and matching icon", async () => {
  const tabId = 103;
  const url = "https://unknown-status.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  await listeners.runtime.onMessage.listener(
    { type: "navigation-status", statusCode: 599, url },
    { frameId: 0, tab: { id: tabId }, url }
  );
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "599 Network Connect Timeout Error");
  assert.equal(getCalls("setIcon", tabId, appliedCalls).at(-1)[1].path[16], "icons/status/599.svg");
});

test("request errors show ERR when no HTTP status was received", async () => {
  const tabId = 104;
  const url = "https://network-error.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", { tabId, requestId: "network-error", url });
  await emitWebRequest("onErrorOccurred", {
    tabId,
    requestId: "network-error",
    url
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "No HTTP response received");
  assert.equal(getCalls("setIcon", tabId, appliedCalls).at(-1)[1].path[16], "icons/status/error.svg");
  assert.equal(context.__testHooks.getActiveRequest(tabId), null);
});

test("an old request error cannot overwrite a newer request", async () => {
  const tabId = 105;
  const oldUrl = "https://error-old.example/";
  const newUrl = "https://error-new.example/";
  setTab(tabId, newUrl);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", { tabId, requestId: "error-old", url: oldUrl });
  emitWebRequest("onBeforeRequest", { tabId, requestId: "error-new", url: newUrl });
  await emitWebRequest("onErrorOccurred", { tabId, requestId: "error-old", url: oldUrl });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");
  await emitWebRequest("onErrorOccurred", { tabId, requestId: "error-new", url: newUrl });
  await settle(tabId);
  assert.equal(getEffectiveTitle(tabId), "No HTTP response received");
});

test("invalid tab IDs are ignored by web request handling", async () => {
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", { tabId: -1, requestId: "invalid-tab", url: "https://invalid.example/" });
  await emitWebRequest("onCompleted", {
    tabId: -1,
    requestId: "invalid-tab",
    statusCode: 200,
    url: "https://invalid.example/"
  });
  await flush();

  assert.equal(calls.length, 0);
});

test("navigation status validates message type, frame, tab, and status range", async () => {
  const invalidMessages = [
    [{ type: "other", statusCode: 200 }, { frameId: 0, tab: { id: 106 }, url: "https://invalid-message.example/" }],
    [{ type: "navigation-status", statusCode: 200 }, { frameId: 1, tab: { id: 107 }, url: "https://invalid-frame.example/" }],
    [{ type: "navigation-status", statusCode: 99 }, { frameId: 0, tab: { id: 108 }, url: "https://invalid-low.example/" }],
    [{ type: "navigation-status", statusCode: 600 }, { frameId: 0, tab: { id: 109 }, url: "https://invalid-high.example/" }],
    [{ type: "navigation-status", statusCode: 200 }, { frameId: 0, tab: { id: -1 }, url: "https://invalid-id.example/" }],
    [{ type: "navigation-status", statusCode: 200 }, { frameId: 0, url: "https://missing-tab.example/" }]
  ];

  calls.length = 0;
  appliedCalls.length = 0;

  for (const [message, sender] of invalidMessages) {
    await listeners.runtime.onMessage.listener(message, sender);
  }

  await flush();
  assert.equal(calls.length, 0);
});

test("navigation timing accepts a fragment URL and stores the normalized URL", async () => {
  const tabId = 110;
  const url = "https://fragment.example/page";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  await listeners.runtime.onMessage.listener(
    { type: "navigation-status", statusCode: 302, url: `${url}#details` },
    { frameId: 0, tab: { id: tabId }, url: `${url}#details` }
  );
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "302 Found");
  assert.equal(context.__testHooks.getTabRecord(tabId).url, url);
});

test("navigation timing rejects active and tab URL mismatches", async () => {
  const tabId = 111;
  const activeUrl = "https://active-url.example/";
  const otherUrl = "https://other-url.example/";
  setTab(tabId, activeUrl);
  emitWebRequest("onBeforeRequest", { tabId, requestId: "active-url", url: activeUrl });
  await settle(tabId);
  calls.length = 0;
  appliedCalls.length = 0;

  await listeners.runtime.onMessage.listener(
    { type: "navigation-status", statusCode: 200, url: otherUrl },
    { frameId: 0, tab: { id: tabId }, url: otherUrl }
  );
  await settle(tabId);
  assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");
  assert.equal(getCalls("setTitle", tabId, appliedCalls).length, 0);
});

test("same-document navigation preserves the current status and ignores subframes", async () => {
  const tabId = 112;
  const url = "https://same-document.example/page";
  setTab(tabId, url);
  emitWebRequest("onBeforeRequest", { tabId, requestId: "same-document", url });
  await emitWebRequest("onCompleted", { tabId, requestId: "same-document", statusCode: 200, url });
  await settle(tabId);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebNavigation("onHistoryStateUpdated", {
    tabId,
    frameId: 1,
    url: `${url}#subframe`
  });
  emitWebNavigation("onReferenceFragmentUpdated", {
    tabId,
    frameId: 0,
    url: `${url}#section`
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "200 OK");
  assert.equal(context.__testHooks.getHistory(tabId).length, 1);
});

test("older navigation timestamps cannot clear a newer request", async () => {
  const tabId = 113;
  const url = "https://timestamp.example/";
  setTab(tabId, url);
  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "timestamp-request",
    timeStamp: 200,
    url
  });
  await settle(tabId);
  const token = context.__testHooks.getNavigationToken(tabId);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebNavigation("onBeforeNavigate", {
    tabId,
    frameId: 0,
    timeStamp: 100,
    url: "https://timestamp-new.example/"
  });
  await settle(tabId);

  assert.equal(context.__testHooks.getNavigationToken(tabId), token);
  assert.equal(context.__testHooks.getActiveRequest(tabId).requestId, "timestamp-request");
  assert.equal(getCalls("setTitle", tabId, appliedCalls).length, 0);
});

test("cached navigation restores a prior URL from history", async () => {
  const tabId = 114;
  const oldUrl = "https://history.example/old";
  const newUrl = "https://history.example/new";
  setTab(tabId, newUrl);

  emitWebRequest("onBeforeRequest", { tabId, requestId: "history-old", url: oldUrl });
  await emitWebRequest("onCompleted", { tabId, requestId: "history-old", statusCode: 304, url: oldUrl });
  await settle(tabId);
  emitWebRequest("onBeforeRequest", { tabId, requestId: "history-new", url: newUrl });
  await emitWebRequest("onCompleted", { tabId, requestId: "history-new", statusCode: 500, url: newUrl });
  await settle(tabId);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebNavigation("onCommitted", {
    tabId,
    frameId: 0,
    documentLifecycle: "cached",
    url: oldUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "304 Not Modified");
});

test("forward-back navigation restores history by transition qualifier", async () => {
  const tabId = 115;
  const firstUrl = "https://back-forward.example/first";
  const secondUrl = "https://back-forward.example/second";
  setTab(tabId, firstUrl);

  emitWebRequest("onBeforeRequest", { tabId, requestId: "bf-first", url: firstUrl });
  await emitWebRequest("onCompleted", { tabId, requestId: "bf-first", statusCode: 201, url: firstUrl });
  await settle(tabId);
  emitWebRequest("onBeforeRequest", { tabId, requestId: "bf-second", url: secondUrl });
  await emitWebRequest("onCompleted", { tabId, requestId: "bf-second", statusCode: 202, url: secondUrl });
  await settle(tabId);

  emitWebNavigation("onCommitted", {
    tabId,
    frameId: 0,
    transitionQualifiers: ["forward_back"],
    url: firstUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "201 Created");
});

test("cached navigation preserves persisted history across restart and a new request", async () => {
  const tabId = 131;
  const firstUrl = "https://persisted-history.example/first";
  const secondUrl = "https://persisted-history.example/second";
  const thirdUrl = "https://persisted-history.example/third";
  setTab(tabId, secondUrl);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "persisted-first",
    documentId: "persisted-document-first",
    url: firstUrl
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "persisted-first",
    statusCode: 201,
    documentId: "persisted-document-first",
    url: firstUrl
  });
  await settle(tabId);
  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "persisted-second",
    documentId: "persisted-document-second",
    url: secondUrl
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "persisted-second",
    statusCode: 404,
    documentId: "persisted-document-second",
    url: secondUrl
  });
  await settle(tabId);
  await settleStorage(tabId);
  context.__testHooks.simulateRestart();
  setTab(tabId, thirdUrl);
  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "persisted-third",
    documentId: "persisted-document-third",
    url: thirdUrl
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "persisted-third",
    statusCode: 503,
    documentId: "persisted-document-third",
    url: thirdUrl
  });
  await settle(tabId);
  await settleStorage(tabId);
  context.__testHooks.simulateRestart();
  setTab(tabId, firstUrl);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebNavigation("onCommitted", {
    tabId,
    frameId: 0,
    documentId: "persisted-document-first",
    documentLifecycle: "cached",
    url: firstUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "201 Created");
  assert.equal(
    getCalls("setIcon", tabId, appliedCalls).at(-1)[1].path[16],
    "icons/status/201.svg"
  );
  assert.ok(context.__testHooks.getHistory(tabId).length >= 2);
});

test("rendering retries a transient toolbar failure once", async () => {
  const tabId = 116;
  const url = "https://render-retry.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;
  context.__testHooks.setActionFailure("icon", [new Error("temporary toolbar failure")]);

  await listeners.runtime.onMessage.listener(
    { type: "navigation-status", statusCode: 200, url },
    { frameId: 0, tab: { id: tabId }, url }
  );
  await settle(tabId);
  context.__testHooks.clearFailures();

  assert.equal(getCalls("setIcon", tabId).length, 2);
  assert.equal(getCalls("setIcon", tabId, appliedCalls).length, 1);
  assert.equal(getEffectiveTitle(tabId), "200 OK");
});

test("closed tabs do not trigger an unnecessary render retry", async () => {
  const tabId = 117;
  const url = "https://closed-tab.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;
  context.__testHooks.setActionFailure("icon", new Error("Invalid tab ID"));

  await listeners.runtime.onMessage.listener(
    { type: "navigation-status", statusCode: 204, url },
    { frameId: 0, tab: { id: tabId }, url }
  );
  await settle(tabId);
  context.__testHooks.clearFailures();

  assert.equal(getCalls("setIcon", tabId).length, 1);
  assert.equal(getEffectiveTitle(tabId), "204 No Content");
});

test("title failures retry the complete toolbar render", async () => {
  const tabId = 118;
  const url = "https://title-retry.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;
  context.__testHooks.setActionFailure("title", [new Error("temporary title failure")]);

  await listeners.runtime.onMessage.listener(
    { type: "navigation-status", statusCode: 301, url },
    { frameId: 0, tab: { id: tabId }, url }
  );
  await settle(tabId);
  context.__testHooks.clearFailures();

  assert.equal(getCalls("setTitle", tabId).length, 2);
  assert.equal(getEffectiveTitle(tabId), "301 Moved Permanently");
});

test("storage write failures do not prevent toolbar updates", async () => {
  const tabId = 119;
  const url = "https://storage-write-failure.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;
  context.__testHooks.setStorageFailure("set", [new Error("storage unavailable")]);

  await listeners.runtime.onMessage.listener(
    { type: "navigation-status", statusCode: 201, url },
    { frameId: 0, tab: { id: tabId }, url }
  );
  await settle(tabId);
  await settleStorage(tabId, { allowFailure: true });
  context.__testHooks.clearFailures();

  assert.equal(getEffectiveTitle(tabId), "201 Created");
  assert.equal(getCalls("setTitle", tabId, appliedCalls).at(-1)[1].title, "201 Created");
});

test("stored state is restored after a background restart", async () => {
  const tabId = 120;
  const url = "https://storage-restore.example/";
  setTab(tabId, url);
  emitWebRequest("onBeforeRequest", { tabId, requestId: "stored", url });
  await emitWebRequest("onCompleted", { tabId, requestId: "stored", statusCode: 418, url });
  await settle(tabId);
  await settleStorage(tabId);
  context.__testHooks.simulateRestart();
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebNavigation("onCommitted", { tabId, frameId: 0, url });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "418 I'm a teapot");
  assert.equal(getCalls("setIcon", tabId, appliedCalls).at(-1)[1].path[16], "icons/status/418.svg");
});

test("malformed session state is discarded and rendered as pending", async () => {
  const tabId = 132;
  const url = "https://malformed-storage.example/";
  const stateKey = `tab-state:${tabId}`;
  const historyKey = `tab-history:${tabId}`;
  setTab(tabId, url);
  sessionStore[stateKey] = {
    state: { text: "999", title: "Invalid" },
    url,
    updatedAt: Date.now()
  };
  sessionStore[historyKey] = { invalid: true };
  context.__testHooks.simulateRestart();
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebNavigation("onCommitted", { tabId, frameId: 0, url });
  await settle(tabId);
  await settleStorage(tabId);

  assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");
  assert.equal(
    getCalls("setIcon", tabId, appliedCalls).at(-1)[1].path[16],
    "icons/status/pending.svg"
  );
  assert.equal(context.__testHooks.getSessionStore()[stateKey], undefined);
  assert.equal(context.__testHooks.getSessionStore()[historyKey], undefined);
  assert.equal(context.__testHooks.isFinalState(undefined), false);
});

test("storage read failures fall back to the neutral state", async () => {
  const tabId = 121;
  const url = "https://storage-read-failure.example/";
  setTab(tabId, url);
  context.__testHooks.simulateRestart();
  context.__testHooks.setStorageFailure("get", [new Error("storage unavailable")]);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebNavigation("onCommitted", { tabId, frameId: 0, url });
  await settle(tabId);
  context.__testHooks.clearFailures();

  assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");
  assert.equal(getCalls("setIcon", tabId, appliedCalls).at(-1)[1].path[16], "icons/status/pending.svg");
});

test("tabs update requests a fresh content status report after completion", async () => {
  const tabId = 122;
  const url = "https://tabs-updated.example/";
  setTab(tabId, url);
  emitWebRequest("onBeforeRequest", { tabId, requestId: "tabs-updated", url });
  await emitWebRequest("onCompleted", { tabId, requestId: "tabs-updated", statusCode: 200, url });
  await settle(tabId);
  calls.length = 0;
  appliedCalls.length = 0;

  await listeners.tabs.onUpdated.listener(tabId, { status: "loading" }, { id: tabId, url });
  assert.equal(calls.length, 0);

  await listeners.tabs.onUpdated.listener(tabId, { status: "complete" }, { id: tabId, url });
  await settle(tabId);
  assert.equal(getCalls("sendMessage", tabId, appliedCalls).at(-1)[1].message.type, "report-navigation-status");
  assert.equal(getEffectiveTitle(tabId), "200 OK");
});

test("tab activation restores the active tab state and missing tabs are safe", async () => {
  const tabId = 123;
  const url = "https://tabs-activated.example/";
  setTab(tabId, url);
  emitWebRequest("onBeforeRequest", { tabId, requestId: "tabs-activated", url });
  await emitWebRequest("onCompleted", { tabId, requestId: "tabs-activated", statusCode: 302, url });
  await settle(tabId);
  calls.length = 0;
  appliedCalls.length = 0;

  await listeners.tabs.onActivated.listener({ tabId });
  await settle(tabId);
  assert.equal(getEffectiveTitle(tabId), "302 Found");

  context.__testHooks.setTabFailure("get", new Error("Invalid tab ID"));
  await listeners.tabs.onActivated.listener({ tabId: 9999 });
  context.__testHooks.clearFailures();
});

test("removed tabs clear memory and session state", async () => {
  const tabId = 124;
  const url = "https://tabs-removed.example/";
  setTab(tabId, url);
  emitWebRequest("onBeforeRequest", { tabId, requestId: "tabs-removed", url });
  await emitWebRequest("onCompleted", { tabId, requestId: "tabs-removed", statusCode: 204, url });
  await settle(tabId);
  await settleStorage(tabId);

  listeners.tabs.onRemoved.listener(tabId);
  await settleStorage(tabId);

  assert.equal(context.__testHooks.getTabRecord(tabId), null);
  assert.equal(context.__testHooks.getActiveRequest(tabId), null);
  assert.equal(context.__testHooks.getCommittedNavigation(tabId), null);
  assert.equal(context.__testHooks.getSessionStore()[`tab-state:${tabId}`], undefined);
  assert.equal(context.__testHooks.getSessionStore()[`tab-history:${tabId}`], undefined);
});

test("a content message cannot recreate state for a closed tab", async () => {
  const tabId = 133;
  const url = "https://closed-message.example/";
  setTab(tabId, url);
  tabRecords.delete(tabId);
  listeners.tabs.onRemoved.listener(tabId);
  await settleStorage(tabId);
  calls.length = 0;
  appliedCalls.length = 0;

  await listeners.runtime.onMessage.listener(
    { type: "navigation-status", statusCode: 200, url },
    { frameId: 0, tab: { id: tabId }, url }
  );
  await flush();

  assert.equal(context.__testHooks.getTabRecord(tabId), null);
  assert.equal(context.__testHooks.getSessionStore()[`tab-state:${tabId}`], undefined);
  assert.equal(getCalls("setIcon", tabId, appliedCalls).length, 0);
});

test("a stale storage read cannot repopulate a removed tab", async () => {
  const tabId = 134;
  const url = "https://closed-storage-read.example/";
  setTab(tabId, url);
  context.__testHooks.rememberTabState(tabId, context.__testHooks.getStatusState(200), {
    url,
    documentId: "closed-storage-document"
  });
  await settle(tabId);
  await settleStorage(tabId);
  context.__testHooks.simulateRestart();
  const originalGet = browser.storage.session.get;
  const barrier = createDeferred();
  browser.storage.session.get = async (key) => {
    const stored = await originalGet(key);
    await barrier.promise;
    return stored;
  };

  try {
    const pendingRead = context.__testHooks.getRememberedTabState(tabId);
    await flush();
    tabRecords.delete(tabId);
    listeners.tabs.onRemoved.listener(tabId);
    await settleStorage(tabId);
    barrier.resolve();

    assert.equal(await pendingRead, null);
    assert.equal(context.__testHooks.getTabRecord(tabId), null);
    assert.equal(context.__testHooks.getHistory(tabId).length, 0);
    assert.equal(context.__testHooks.getSessionStore()[`tab-state:${tabId}`], undefined);
    assert.equal(context.__testHooks.getSessionStore()[`tab-history:${tabId}`], undefined);
  } finally {
    browser.storage.session.get = originalGet;
  }
});

test("background startup does not register cache-flushing listeners", () => {
  assert.equal(listeners.runtime.onInstalled, undefined);
  assert.equal(listeners.runtime.onStartup, undefined);
});

test("internal state helpers guard invalid tabs and compare records precisely", async () => {
  const hooks = context.__testHooks;
  const record = { url: "https://record.example/", documentId: "document-1" };

  assert.equal(await hooks.getRememberedTabState(-1), null);
  assert.equal(hooks.rememberTabState(-1, hooks.getStatusState(200)), null);
  await hooks.renderState(-1, hooks.getStatusState(200));
  await hooks.queueRender(-1, hooks.getStatusState(200));
  await hooks.restoreTabState(-1, record.url);
  assert.equal(await hooks.recordsMatch(null, record.url), false);
  assert.equal(await hooks.recordsMatch(record, record.url, "document-1"), true);
  assert.equal(await hooks.recordsMatch(record, record.url, "document-2"), false);
  assert.equal(await hooks.recordsMatch(record, record.url), true);
  assert.equal(await hooks.recordsMatch(record, ""), false);
  assert.equal(hooks.isClosedTabError(new Error("No tab with id")), true);
  assert.equal(hooks.isClosedTabError(new Error("permission denied")), false);
});

test("history lookup can recover a prior document by document ID", async () => {
  const hooks = context.__testHooks;
  const tabId = 125;
  const oldUrl = "https://document-history.example/old";
  const newUrl = "https://document-history.example/new";

  hooks.rememberTabState(tabId, hooks.getStatusState(200), {
    url: oldUrl,
    documentId: "old-document"
  });
  hooks.rememberTabState(tabId, hooks.getStatusState(201), {
    url: newUrl,
    documentId: "new-document"
  });
  await settle(tabId);

  const record = await hooks.findTabState(tabId, oldUrl, "old-document", true);
  assert.equal(record.state.title, "200 OK");
  assert.equal(record.documentId, "old-document");
});

test("same-document navigation without remembered state falls back to neutral", async () => {
  const tabId = 126;
  const url = "https://same-document-empty.example/";
  calls.length = 0;
  appliedCalls.length = 0;

  await context.__testHooks.handleSameDocumentNavigation({
    tabId,
    frameId: 0,
    url
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");
  assert.equal(getCalls("setIcon", tabId, appliedCalls).at(-1)[1].path[16], "icons/status/pending.svg");
});

test("navigation stage and before-navigation ignore subframes and invalid tabs", async () => {
  const tabId = 127;
  const url = "https://navigation-guards.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  await context.__testHooks.handleBeforeNavigation({ tabId, frameId: 1, url, timeStamp: Date.now() + 1000 });
  await context.__testHooks.handleBeforeNavigation({ tabId: -1, frameId: 0, url, timeStamp: Date.now() + 1000 });
  await context.__testHooks.handleNavigationStage({ tabId, frameId: 1, url });
  await settle(tabId);

  assert.equal(calls.length, 0);
});

test("a second render failure is logged without rejecting the queue", async () => {
  const tabId = 128;
  const url = "https://render-double-failure.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;
  context.__testHooks.setActionFailure("icon", [
    new Error("first toolbar failure"),
    new Error("second toolbar failure")
  ]);

  await listeners.runtime.onMessage.listener(
    { type: "navigation-status", statusCode: 500, url },
    { frameId: 0, tab: { id: tabId }, url }
  );
  await settle(tabId);
  context.__testHooks.clearFailures();

  assert.equal(getCalls("setIcon", tabId).length, 2);
  assert.equal(getEffectiveTitle(tabId), "500 Internal Server Error");
});

test("direct web request status application rejects invalid tabs", async () => {
  const accepted = await context.__testHooks.applyWebRequestStatus({
    tabId: -1,
    requestId: "invalid-direct",
    statusCode: 200,
    url: "https://invalid-direct.example/"
  });

  assert.equal(accepted, false);
});

test("session storage persists URL hashes without raw browsing URLs", async () => {
  const tabId = 135;
  const url = "https://privacy.example/account?access_token=top-secret";
  setTab(tabId, url);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "privacy-request",
    url
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "privacy-request",
    statusCode: 200,
    url
  });
  await settle(tabId);
  await settleStorage(tabId);

  const stored = context.__testHooks.getSessionStore();
  const serialized = JSON.stringify(stored);
  const state = stored[`tab-state:${tabId}`];
  const history = stored[`tab-history:${tabId}`];

  assert.doesNotMatch(serialized, /privacy\.example|access_token|top-secret/);
  assert.equal(Object.hasOwn(state, "url"), false);
  assert.match(state.urlHash, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(history));
  assert.ok(history.length > 0);
  assert.equal(history.every((record) => !Object.hasOwn(record, "url")), true);
  assert.equal(history.every((record) => /^[a-f0-9]{64}$/.test(record.urlHash)), true);
});

test("webNavigation tokens never embed raw URLs in session storage", async () => {
  const tabId = 140;
  const url = "https://navigation-privacy.example/path?session=classified";
  setTab(tabId, url);

  await context.__testHooks.handleBeforeNavigation({
    tabId,
    frameId: 0,
    timeStamp: Date.now() + 1_000,
    url
  });
  await settle(tabId);
  await settleStorage(tabId);

  const stored = context.__testHooks.getSessionStore()[`tab-state:${tabId}`];
  const serialized = JSON.stringify(stored);

  assert.doesNotMatch(serialized, /navigation-privacy|session|classified/);
  assert.match(stored.navigationToken, /^140:\d+:\d+$/);
  assert.match(stored.urlHash, /^[a-f0-9]{64}$/);
});

test("history repair serializes in-memory records without raw URLs", async () => {
  const tabId = 141;
  const url = "https://history-repair.example/private?key=hidden";
  const historyKey = `tab-history:${tabId}`;
  setTab(tabId, url);
  sessionStore[historyKey] = [{ invalid: true }];

  context.__testHooks.rememberTabState(
    tabId,
    context.__testHooks.getStatusState(201),
    { url }
  );
  await settle(tabId);
  await settleStorage(tabId);

  const storedHistory = context.__testHooks.getSessionStore()[historyKey];
  const serialized = JSON.stringify(storedHistory);

  assert.doesNotMatch(serialized, /history-repair|private|hidden/);
  assert.ok(Array.isArray(storedHistory));
  assert.equal(storedHistory.every((record) => !Object.hasOwn(record, "url")), true);
  assert.equal(storedHistory.every((record) => /^[a-f0-9]{64}$/.test(record.urlHash)), true);
});

test("legacy session records containing raw URLs are removed", async () => {
  const tabId = 136;
  const url = "https://legacy-storage.example/?private=value";
  const stateKey = `tab-state:${tabId}`;
  setTab(tabId, url);
  sessionStore[stateKey] = {
    state: { text: "200", title: "200 OK" },
    url,
    updatedAt: Date.now()
  };
  context.__testHooks.simulateRestart();

  emitWebNavigation("onCommitted", { tabId, frameId: 0, url });
  await settle(tabId);
  await settleStorage(tabId);

  assert.equal(context.__testHooks.getSessionStore()[stateKey], undefined);
  assert.equal(getEffectiveTitle(tabId), "Waiting for an HTTP status code");
});

test("a completed download request cannot replace the committed page status", async () => {
  const tabId = 137;
  const pageUrl = "https://download-origin.example/page";
  const downloadUrl = "https://download-origin.example/archive.zip";
  setTab(tabId, pageUrl);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "page-request",
    url: pageUrl
  });
  emitWebNavigation("onCommitted", {
    tabId,
    frameId: 0,
    documentId: "page-document",
    documentLifecycle: "active",
    url: pageUrl
  });
  await settle(tabId);
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "page-request",
    statusCode: 204,
    documentId: "page-document",
    url: pageUrl
  });
  await settle(tabId);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "download-request",
    url: downloadUrl
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "download-request",
    statusCode: 200,
    url: downloadUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "204 No Content");
  assert.equal(context.__testHooks.getActiveRequest(tabId), null);
});

test("a committed navigation wins when the tabs URL update is delayed", async () => {
  const tabId = 142;
  const oldUrl = "https://commit-race.example/old";
  const newUrl = "https://commit-race.example/new";
  setTab(tabId, oldUrl);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "commit-race-old",
    documentId: "commit-race-old-document",
    url: oldUrl
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "commit-race-old",
    statusCode: 200,
    documentId: "commit-race-old-document",
    url: oldUrl
  });
  await settle(tabId);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "commit-race-new",
    documentId: "commit-race-new-document",
    url: newUrl
  });
  emitWebNavigation("onCommitted", {
    tabId,
    frameId: 0,
    documentId: "commit-race-new-document",
    documentLifecycle: "active",
    url: newUrl
  });
  await settle(tabId);
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "commit-race-new",
    statusCode: 201,
    documentId: "commit-race-new-document",
    url: newUrl
  });
  await settle(tabId);

  assert.equal(context.__testHooks.getCommittedNavigation(tabId).url, newUrl);
  assert.equal(getEffectiveTitle(tabId), "201 Created");
});

test("a failed noncommitted request cannot replace the committed page status", async () => {
  const tabId = 138;
  const pageUrl = "https://failed-download.example/page";
  const downloadUrl = "https://failed-download.example/archive.zip";
  setTab(tabId, pageUrl);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "failed-page-request",
    url: pageUrl
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "failed-page-request",
    statusCode: 200,
    url: pageUrl
  });
  await settle(tabId);

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "failed-download-request",
    url: downloadUrl
  });
  await emitWebRequest("onErrorOccurred", {
    tabId,
    requestId: "failed-download-request",
    url: downloadUrl
  });
  await settle(tabId);

  assert.equal(getEffectiveTitle(tabId), "200 OK");
  assert.equal(context.__testHooks.getActiveRequest(tabId), null);
});

test("prerender lifecycle events cannot mutate the active tab indicator", async () => {
  const tabId = 139;
  const url = "https://prerender.example/";
  setTab(tabId, url);
  calls.length = 0;
  appliedCalls.length = 0;

  emitWebRequest("onBeforeRequest", {
    tabId,
    requestId: "prerender-request",
    documentLifecycle: "prerender",
    url
  });
  emitWebRequest("onHeadersReceived", {
    tabId,
    requestId: "prerender-request",
    documentLifecycle: "prerender",
    statusCode: 200,
    url
  });
  await emitWebRequest("onCompleted", {
    tabId,
    requestId: "prerender-request",
    documentLifecycle: "prerender",
    statusCode: 200,
    url
  });
  await context.__testHooks.handleBeforeNavigation({
    tabId,
    frameId: 0,
    documentLifecycle: "prerender",
    url
  });
  await context.__testHooks.handleNavigationStage({
    tabId,
    frameId: 0,
    documentLifecycle: "prerender",
    url
  });
  await flush();

  assert.equal(context.__testHooks.getTabRecord(tabId), null);
  assert.equal(context.__testHooks.getActiveRequest(tabId), null);
  assert.equal(getCalls("setIcon", tabId, appliedCalls).length, 0);
});

test("tooltip titles use current HTTP terminology", () => {
  const getStatusState = context.__testHooks.getStatusState;

  assert.equal(getStatusState(203).title, "203 Non-Authoritative Information");
  assert.equal(getStatusState(413).title, "413 Content Too Large");
  assert.equal(getStatusState(414).title, "414 URI Too Long");
  assert.equal(getStatusState(416).title, "416 Range Not Satisfiable");
  assert.equal(getStatusState(422).title, "422 Unprocessable Content");
});
