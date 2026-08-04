const STATUS_TITLES = Object.freeze({
  100: "Continue",
  101: "Switching Protocols",
  102: "Processing",
  103: "Early Hints",
  200: "OK",
  201: "Created",
  202: "Accepted",
  203: "Non-Authoritative Information",
  204: "No Content",
  205: "Reset Content",
  206: "Partial Content",
  207: "Multi-Status",
  208: "Already Reported",
  226: "IM Used",
  300: "Multiple Choices",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  305: "Use Proxy",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a teapot",
  421: "Misdirected Request",
  422: "Unprocessable Content",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  444: "Connection Closed Without Response",
  451: "Unavailable For Legal Reasons",
  499: "Client Closed Request",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
  599: "Network Connect Timeout Error"
});

const STATUS_CLASS_TITLES = Object.freeze({
  1: "Informational",
  2: "Success",
  3: "Redirection",
  4: "Client Error",
  5: "Server Error"
});

const STATUS_CODES_URL = "https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status";
const TAB_STATE_KEY_PREFIX = "tab-state:";
const TAB_HISTORY_KEY_PREFIX = "tab-history:";
const MAX_HISTORY_ENTRIES = 20;
const URL_HASH_PATTERN = /^[a-f0-9]{64}$/;
const NAVIGATION_TOKEN_PATTERN = /^\d+:\d+:\d+$/;
const tabStateCache = new Map();
const tabHistoryCache = new Map();
const activeRequests = new Map();
const committedNavigations = new Map();
const navigationTokens = new Map();
const renderQueues = new Map();
const renderVersions = new Map();
const storageQueues = new Map();
const tabHistoryLoadTasks = new Map();
const loadedTabHistoryIds = new Set();
const closedTabIds = new Set();
let navigationTokenCounter = 0;

const NEUTRAL_STATE = Object.freeze({
  text: "...",
  title: "Waiting for an HTTP status code"
});

const ERROR_STATE = Object.freeze({
  text: "ERR",
  title: "No HTTP response received"
});

function getStatusState(statusCode) {
  const code = Number(statusCode);
  const statusClassTitle = STATUS_CLASS_TITLES[Math.trunc(code / 100)];

  if (!Number.isInteger(code) || !statusClassTitle) {
    return ERROR_STATE;
  }

  return {
    text: String(code),
    title: code + " " + (STATUS_TITLES[code] ?? statusClassTitle)
  };
}

function getIconPath(state) {
  const text = state?.text;
  const fileName = /^[1-5]\d{2}$/.test(text)
    ? text
    : text === "ERR"
      ? "error"
      : "pending";
  const path = `icons/status/${fileName}.svg`;

  return { 16: path, 32: path, 64: path };
}

function normalizeUrl(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "";
  }

  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return value;
  }
}

function normalizeUrlHash(value) {
  return typeof value === "string" && URL_HASH_PATTERN.test(value.toLowerCase())
    ? value.toLowerCase()
    : "";
}

function normalizeNavigationToken(value) {
  return typeof value === "string" && NAVIGATION_TOKEN_PATTERN.test(value)
    ? value
    : "";
}

async function hashUrl(value) {
  const normalizedUrl = normalizeUrl(value);

  if (!normalizedUrl) {
    return "";
  }

  const data = new TextEncoder().encode(normalizedUrl);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getTabStateKey(tabId) {
  return TAB_STATE_KEY_PREFIX + tabId;
}

function getTabHistoryKey(tabId) {
  return TAB_HISTORY_KEY_PREFIX + tabId;
}

function isUsableTabId(tabId) {
  return Number.isInteger(tabId) && tabId >= 0;
}

function isOpenTabId(tabId) {
  return isUsableTabId(tabId) && !closedTabIds.has(tabId);
}

function createNavigationToken(tabId) {
  navigationTokenCounter += 1;
  return [tabId, Date.now(), navigationTokenCounter].join(":");
}

function getNavigationToken(tabId) {
  return navigationTokens.get(tabId) ?? "";
}

function collectObsoleteRequestIds(...values) {
  const requestIds = values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === "string" && value.length > 0);

  return [...new Set(requestIds)].slice(-8);
}

function isValidState(state) {
  return Boolean(
    state &&
    typeof state === "object" &&
    typeof state.title === "string" &&
    state.title.length > 0 &&
    (
      state.text === NEUTRAL_STATE.text ||
      state.text === ERROR_STATE.text ||
      /^[1-5]\d{2}$/.test(state.text)
    )
  );
}

function normalizeStoredState(state) {
  if (state?.text === NEUTRAL_STATE.text) {
    return NEUTRAL_STATE;
  }

  if (state?.text === ERROR_STATE.text) {
    return ERROR_STATE;
  }

  if (/^[1-5]\d{2}$/.test(state?.text)) {
    return getStatusState(Number(state.text));
  }

  return null;
}

function normalizeStoredRecord(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(value, "url")) {
    return null;
  }

  const state = normalizeStoredState(value.state);

  if (!state) {
    return null;
  }

  const urlHash = normalizeUrlHash(value.urlHash);
  const documentId = typeof value.documentId === "string" ? value.documentId : "";

  if (!urlHash && !documentId) {
    return null;
  }

  return {
    state,
    url: "",
    urlHash,
    source: typeof value.source === "string" ? value.source : "unknown",
    requestId: typeof value.requestId === "string" ? value.requestId : "",
    obsoleteRequestIds: collectObsoleteRequestIds(value.obsoleteRequestIds),
    documentId,
    navigationToken: normalizeNavigationToken(value.navigationToken),
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0
  };
}

async function serializeRecord(record) {
  const urlHash = normalizeUrlHash(record.urlHash) || await hashUrl(record.url);

  if (urlHash && !record.urlHash) {
    record.urlHash = urlHash;
  }

  return {
    state: record.state,
    urlHash,
    source: record.source,
    requestId: record.requestId,
    obsoleteRequestIds: record.obsoleteRequestIds,
    documentId: record.documentId,
    navigationToken: normalizeNavigationToken(record.navigationToken),
    updatedAt: record.updatedAt
  };
}

function getRecordUrlIdentity(record) {
  const urlHash = normalizeUrlHash(record?.urlHash);

  if (urlHash) {
    return `hash:${urlHash}`;
  }

  const url = normalizeUrl(record?.url);
  return url ? `url:${url}` : "";
}

function mergeTabHistory(records) {
  let history = [];

  for (const record of records) {
    const recordIdentity = getRecordUrlIdentity(record);

    if (!record || !isFinalState(record.state) || (!recordIdentity && !record.documentId)) {
      continue;
    }

    history = history.filter((entry) => {
      if (record.documentId && entry.documentId) {
        return entry.documentId !== record.documentId;
      }

      const entryIdentity = getRecordUrlIdentity(entry);
      return !recordIdentity || entryIdentity !== recordIdentity;
    });
    history.push(record);
  }

  return history.slice(-MAX_HISTORY_ENTRIES);
}

function normalizeStoredHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return mergeTabHistory(value.map(normalizeStoredRecord));
}

function queueStorageOperation(tabId, operation) {
  const previous = storageQueues.get(tabId) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(operation);

  storageQueues.set(tabId, task);
  task.finally(() => {
    if (storageQueues.get(tabId) === task) {
      storageQueues.delete(tabId);
    }
  }).catch(() => undefined);
  return task;
}

function getRememberedTabHistory(tabId) {
  if (!isOpenTabId(tabId)) {
    return Promise.resolve([]);
  }

  if (loadedTabHistoryIds.has(tabId)) {
    return Promise.resolve(tabHistoryCache.get(tabId) ?? []);
  }

  const existingTask = tabHistoryLoadTasks.get(tabId);

  if (existingTask) {
    return existingTask;
  }

  const historyKey = getTabHistoryKey(tabId);
  const task = browser.storage.session
    .get(historyKey)
    .then((stored) => {
      if (!isOpenTabId(tabId)) {
        return [];
      }

      const rawHistory = stored[historyKey];
      const storedHistory = normalizeStoredHistory(rawHistory);
      const memoryHistory = tabHistoryCache.get(tabId) ?? [];
      const history = mergeTabHistory([...storedHistory, ...memoryHistory]);

      if (history.length > 0) {
        tabHistoryCache.set(tabId, history);
      } else {
        tabHistoryCache.delete(tabId);
      }

      loadedTabHistoryIds.add(tabId);
      if (
        rawHistory !== undefined &&
        (!Array.isArray(rawHistory) || rawHistory.length !== storedHistory.length)
      ) {
        queueStorageOperation(
          tabId,
          async () => history.length > 0
            ? browser.storage.session.set({
              [historyKey]: await Promise.all(history.map(serializeRecord))
            })
            : browser.storage.session.remove(historyKey)
        ).catch(() => undefined);
      }
      return history;
    })
    .catch(() => tabHistoryCache.get(tabId) ?? []);

  tabHistoryLoadTasks.set(tabId, task);
  task.finally(() => {
    if (tabHistoryLoadTasks.get(tabId) === task) {
      tabHistoryLoadTasks.delete(tabId);
    }
  }).catch(() => undefined);
  return task;
}

async function getRememberedTabState(tabId) {
  if (!isOpenTabId(tabId)) {
    return null;
  }

  if (tabStateCache.has(tabId)) {
    return tabStateCache.get(tabId);
  }

  const stateKey = getTabStateKey(tabId);
  const stored = await browser.storage.session
    .get(stateKey)
    .catch(() => ({}));

  if (!isOpenTabId(tabId)) {
    return null;
  }

  if (tabStateCache.has(tabId)) {
    return tabStateCache.get(tabId);
  }

  const rawRecord = stored[stateKey];
  const record = normalizeStoredRecord(rawRecord);

  if (record) {
    tabStateCache.set(tabId, record);
  }

  const invalidState = rawRecord !== undefined && !record;

  if (invalidState) {
    queueStorageOperation(
      tabId,
      () => browser.storage.session.remove(stateKey)
    ).catch(() => undefined);
  }

  return record;
}

function isFinalState(state) {
  return isValidState(state) && state.text !== NEUTRAL_STATE.text;
}

async function recordsMatch(record, url, documentId = "") {
  if (!record) {
    return false;
  }

  if (documentId && record.documentId) {
    return documentId === record.documentId;
  }

  const normalizedUrl = normalizeUrl(url);

  if (!normalizedUrl) {
    return false;
  }

  if (record.url) {
    return record.url === normalizedUrl;
  }

  const urlHash = normalizeUrlHash(record.urlHash);
  return Boolean(urlHash) && urlHash === await hashUrl(normalizedUrl);
}

function statesMatch(first, second) {
  return first?.text === second?.text && first?.title === second?.title;
}

function addTabHistory(tabId, record) {
  const recordIdentity = getRecordUrlIdentity(record);

  if (!isFinalState(record.state) || (!recordIdentity && !record.documentId)) {
    return false;
  }

  const history = tabHistoryCache.get(tabId) ?? [];
  const filtered = history.filter((entry) => {
    if (record.documentId && entry.documentId) {
      return entry.documentId !== record.documentId;
    }

    const entryIdentity = getRecordUrlIdentity(entry);
    return !recordIdentity || entryIdentity !== recordIdentity;
  });

  filtered.push(record);
  tabHistoryCache.set(tabId, filtered.slice(-MAX_HISTORY_ENTRIES));
  return true;
}

async function findTabState(tabId, url, documentId = "", allowHistory = false) {
  const normalizedUrl = normalizeUrl(url);
  const current = await getRememberedTabState(tabId);
  const currentMatches = await recordsMatch(current, normalizedUrl, documentId);

  if (currentMatches && (isFinalState(current.state) || !allowHistory)) {
    return current;
  }

  const history = await getRememberedTabHistory(tabId);

  if (documentId) {
    const documentRecord = history.findLast((record) => record.documentId === documentId);

    if (documentRecord) {
      return documentRecord;
    }
  }

  if (allowHistory) {
    const targetHash = await hashUrl(normalizedUrl);
    const urlRecord = history.findLast((record) =>
      record.url === normalizedUrl ||
      Boolean(targetHash) && normalizeUrlHash(record.urlHash) === targetHash
    );

    if (urlRecord) {
      return urlRecord;
    }
  }

  return currentMatches ? current : null;
}

function rememberTabState(tabId, state, metadata = {}) {
  if (!isOpenTabId(tabId) || !isValidState(state)) {
    return null;
  }

  const url = normalizeUrl(metadata.url);
  const existingRecord = tabStateCache.get(tabId);
  const reusableUrlHash = existingRecord?.url === url
    ? normalizeUrlHash(existingRecord.urlHash)
    : "";
  const record = {
    state,
    url,
    urlHash: normalizeUrlHash(metadata.urlHash) || reusableUrlHash,
    source: metadata.source ?? "unknown",
    requestId: metadata.requestId ?? "",
    obsoleteRequestIds: collectObsoleteRequestIds(metadata.obsoleteRequestIds),
    documentId: metadata.documentId ?? "",
    navigationToken: normalizeNavigationToken(
      metadata.navigationToken ?? getNavigationToken(tabId)
    ),
    updatedAt: Date.now()
  };
  const stateKey = getTabStateKey(tabId);
  const historyKey = getTabHistoryKey(tabId);

  tabStateCache.set(tabId, record);
  if (record.navigationToken) {
    navigationTokens.set(tabId, record.navigationToken);
  }
  const historyChanged = addTabHistory(tabId, record);
  queueStorageOperation(
    tabId,
    async () => {
      if (historyChanged) {
        await getRememberedTabHistory(tabId);
      }

      const storedValues = { [stateKey]: await serializeRecord(record) };

      if (historyChanged && loadedTabHistoryIds.has(tabId)) {
        storedValues[historyKey] = await Promise.all(
          (tabHistoryCache.get(tabId) ?? []).map(serializeRecord)
        );
      }

      await browser.storage.session.set(storedValues);
    }
  ).catch(() => undefined);
  queueRender(tabId, state);
  return record;
}

async function renderState(tabId, state) {
  if (!isOpenTabId(tabId)) {
    return;
  }

  const renderableState = isValidState(state) ? state : NEUTRAL_STATE;

  const results = await Promise.allSettled([
    browser.action.setIcon({ tabId, path: getIconPath(renderableState) }),
    browser.action.setTitle({ tabId, title: renderableState.title })
  ]);
  const failed = results.find((result) => result.status === "rejected");

  if (failed) {
    throw failed.reason;
  }
}

function isClosedTabError(error) {
  const message = String(error?.message ?? error);
  return /invalid tab|no tab|tab.+closed/i.test(message);
}

function logRenderError(error) {
  if (!isClosedTabError(error)) {
    globalThis.console?.error("StatusCode: toolbar update failed", error);
  }
}

function queueRender(tabId, state) {
  if (!isOpenTabId(tabId)) {
    return Promise.resolve();
  }

  const version = (renderVersions.get(tabId) ?? 0) + 1;
  renderVersions.set(tabId, version);
  const previous = renderQueues.get(tabId) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(async () => {
      if (renderVersions.get(tabId) !== version) {
        return;
      }

      try {
        await renderState(tabId, state);
      } catch (error) {
        if (renderVersions.get(tabId) !== version || isClosedTabError(error)) {
          return;
        }

        try {
          await renderState(tabId, state);
        } catch (retryError) {
          logRenderError(retryError);
        }
      }
    });

  renderQueues.set(tabId, task);
  task.finally(() => {
    if (renderQueues.get(tabId) === task) {
      renderQueues.delete(tabId);
    }
  }).catch(() => undefined);
  return task;
}

async function restoreTabState(
  tabId,
  url,
  documentId = "",
  allowHistory = false,
  expectedNavigationToken = getNavigationToken(tabId)
) {
  if (!isOpenTabId(tabId)) {
    return;
  }

  const normalizedUrl = normalizeUrl(url);
  const record = await findTabState(tabId, normalizedUrl, documentId, allowHistory);

  if (!isOpenTabId(tabId) || getNavigationToken(tabId) !== expectedNavigationToken) {
    return;
  }

  if (record) {
    if (record !== tabStateCache.get(tabId)) {
      rememberTabState(tabId, record.state, {
        url: normalizedUrl,
        source: record.source,
        requestId: record.requestId,
        obsoleteRequestIds: record.obsoleteRequestIds,
        documentId: documentId || record.documentId,
        navigationToken: expectedNavigationToken
      });
      return;
    }

    await queueRender(tabId, record.state);
    return;
  }

  await queueRender(tabId, NEUTRAL_STATE);
}

const WEB_REQUEST_FILTER = Object.freeze({
  urls: ["http://*/*", "https://*/*"],
  types: ["main_frame"]
});

function isPrerender(details) {
  return details?.documentLifecycle === "prerender";
}

function clearActiveRequest(tabId, requestId) {
  if (activeRequests.get(tabId)?.requestId === requestId) {
    activeRequests.delete(tabId);
  }
}

function rememberCommittedNavigation({ tabId, frameId = 0, url, documentId = "" }) {
  if (frameId !== 0 || !isOpenTabId(tabId)) {
    return;
  }

  committedNavigations.set(tabId, {
    documentId,
    url: normalizeUrl(url)
  });
}

async function restoreCommittedTabState(details) {
  const { tabId, url, documentId = "" } = details;
  const requestUrl = normalizeUrl(url);
  const committed = committedNavigations.get(tabId);

  if (committed) {
    const documentMatches = Boolean(
      documentId && committed.documentId && documentId === committed.documentId
    );

    if (documentMatches || committed.url === requestUrl) {
      return false;
    }

    const expectedNavigationToken = getNavigationToken(tabId);
    await restoreTabState(tabId, committed.url, committed.documentId, true, expectedNavigationToken);
    return true;
  }

  const tab = await browser.tabs.get(tabId).catch(() => null);

  if (!tab || !isOpenTabId(tabId)) {
    return false;
  }

  const committedUrl = normalizeUrl(tab.url);

  if (!committedUrl || committedUrl === requestUrl) {
    return false;
  }

  const expectedNavigationToken = getNavigationToken(tabId);
  await restoreTabState(tabId, committedUrl, "", true, expectedNavigationToken);
  return true;
}

browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const {
      tabId,
      requestId,
      url,
      documentId = "",
      timeStamp = Date.now()
    } = details;

    if (!isOpenTabId(tabId) || isPrerender(details)) {
      return;
    }

    const active = activeRequests.get(tabId);

    if (active?.requestId === requestId) {
      activeRequests.set(tabId, {
        ...active,
        url: normalizeUrl(url),
        documentId: documentId || active.documentId,
        timeStamp
      });
      return;
    }

    const current = tabStateCache.get(tabId);
    const navigationToken =
      current?.source === "webNavigation-pending" && current.navigationToken
        ? current.navigationToken
        : createNavigationToken(tabId);
    const obsoleteRequestIds = collectObsoleteRequestIds(
      current?.obsoleteRequestIds,
      current?.requestId,
      active?.obsoleteRequestIds,
      active?.requestId
    ).filter((obsoleteRequestId) => obsoleteRequestId !== requestId);

    navigationTokens.set(tabId, navigationToken);
    activeRequests.set(tabId, {
      requestId,
      url: normalizeUrl(url),
      obsoleteRequestIds,
      documentId,
      navigationToken,
      timeStamp
    });
    rememberTabState(tabId, NEUTRAL_STATE, {
      url,
      source: "webRequest-pending",
      requestId,
      obsoleteRequestIds,
      documentId,
      navigationToken
    });
  },
  WEB_REQUEST_FILTER
);

async function applyWebRequestStatus(details) {
  const {
    tabId,
    requestId,
    statusCode,
    url,
    documentId = ""
  } = details;

  if (!isOpenTabId(tabId) || isPrerender(details)) {
    return false;
  }

  const expectedNavigationToken = getNavigationToken(tabId);
  const active = activeRequests.get(tabId);

  if (active?.requestId && requestId && active.requestId !== requestId) {
    return false;
  }

  const current = tabStateCache.get(tabId) ?? await getRememberedTabState(tabId);
  const latestActive = activeRequests.get(tabId);

  if (!isOpenTabId(tabId) || getNavigationToken(tabId) !== expectedNavigationToken) {
    return false;
  }

  if (latestActive?.requestId && requestId && latestActive.requestId !== requestId) {
    return false;
  }

  if (current?.obsoleteRequestIds?.includes(requestId)) {
    return false;
  }

  if (!latestActive && current?.requestId && requestId && current.requestId !== requestId) {
    return false;
  }

  const state = getStatusState(statusCode);
  const normalizedUrl = normalizeUrl(url);
  const obsoleteRequestIds =
    latestActive?.obsoleteRequestIds ?? current?.obsoleteRequestIds;
  const resolvedDocumentId =
    documentId || latestActive?.documentId || current?.documentId || "";
  const navigationToken =
    latestActive?.navigationToken || current?.navigationToken || expectedNavigationToken;

  if (
    current?.source === "webRequest" &&
    current.requestId === requestId &&
    await recordsMatch(current, normalizedUrl, resolvedDocumentId) &&
    current.documentId === resolvedDocumentId &&
    current.navigationToken === navigationToken &&
    statesMatch(current.state, state)
  ) {
    return true;
  }

  rememberTabState(tabId, state, {
    url: normalizedUrl,
    source: "webRequest",
    requestId,
    obsoleteRequestIds,
    documentId: resolvedDocumentId,
    navigationToken
  });
  return true;
}

for (const event of [
  browser.webRequest.onHeadersReceived,
  browser.webRequest.onResponseStarted
]) {
  event.addListener(
    (details) => {
      if (isPrerender(details)) {
        return;
      }

      applyWebRequestStatus(details).catch(() => undefined);
    },
    WEB_REQUEST_FILTER
  );
}

browser.webRequest.onCompleted.addListener(
  async (details) => {
    if (isPrerender(details)) {
      return;
    }

    try {
      const applied = await applyWebRequestStatus(details).catch(() => false);

      if (applied) {
        await restoreCommittedTabState(details);
      }
    } finally {
      clearActiveRequest(details.tabId, details.requestId);
    }
  },
  WEB_REQUEST_FILTER
);

browser.webRequest.onErrorOccurred.addListener(
  async (details) => {
    const { tabId, requestId, url, documentId = "" } = details;

    if (!isOpenTabId(tabId) || isPrerender(details)) {
      return;
    }

    const expectedNavigationToken = getNavigationToken(tabId);
    const active = activeRequests.get(tabId);

    if (active?.requestId && requestId && active.requestId !== requestId) {
      return;
    }

    const current = tabStateCache.get(tabId) ?? await getRememberedTabState(tabId);
    const latestActive = activeRequests.get(tabId);

    if (!isOpenTabId(tabId) || getNavigationToken(tabId) !== expectedNavigationToken) {
      return;
    }

    if (latestActive?.requestId && requestId && latestActive.requestId !== requestId) {
      return;
    }

    if (current?.obsoleteRequestIds?.includes(requestId)) {
      return;
    }

    if (!latestActive && current?.requestId && requestId && current.requestId !== requestId) {
      return;
    }

    if (await restoreCommittedTabState(details)) {
      clearActiveRequest(tabId, requestId);
      return;
    }

    if (
      current?.source === "webRequest" &&
      current.requestId === requestId &&
      await recordsMatch(current, url, documentId) &&
      isFinalState(current.state)
    ) {
      clearActiveRequest(tabId, requestId);
      return;
    }

    rememberTabState(tabId, ERROR_STATE, {
      url,
      source: "webRequest-error",
      requestId,
      obsoleteRequestIds: latestActive?.obsoleteRequestIds ?? current?.obsoleteRequestIds,
      documentId: documentId || latestActive?.documentId || current?.documentId,
      navigationToken:
        latestActive?.navigationToken || current?.navigationToken || expectedNavigationToken
    });

    clearActiveRequest(tabId, requestId);
  },
  WEB_REQUEST_FILTER
);

browser.runtime.onMessage.addListener(async (message, sender) => {
  const tabId = sender.tab?.id;
  const statusCode = Number(message?.statusCode);

  if (
    message?.type !== "navigation-status" ||
    sender.frameId !== 0 ||
    !isOpenTabId(tabId) ||
    !Number.isInteger(statusCode) ||
    statusCode < 100 ||
    statusCode > 599
  ) {
    return;
  }

  const url = normalizeUrl(sender.url);

  if (!url) {
    return;
  }
  const expectedNavigationToken = getNavigationToken(tabId);
  const active = activeRequests.get(tabId);

  if (active?.url && active.url !== url) {
    return;
  }

  const tab = await browser.tabs.get(tabId).catch(() => null);

  if (!tab || !isOpenTabId(tabId)) {
    return;
  }

  if (getNavigationToken(tabId) !== expectedNavigationToken) {
    return;
  }

  if (tab.url && normalizeUrl(tab.url) !== url) {
    return;
  }

  const current = await getRememberedTabState(tabId);
  const latestActive = activeRequests.get(tabId);

  if (!isOpenTabId(tabId) || getNavigationToken(tabId) !== expectedNavigationToken) {
    return;
  }

  if (latestActive?.url && latestActive.url !== url) {
    return;
  }

  if (
    sender.documentId &&
    current?.documentId &&
    sender.documentId !== current.documentId
  ) {
    return;
  }

  if (
    current?.source === "webRequest" &&
    await recordsMatch(current, url, sender.documentId ?? "") &&
    isFinalState(current.state)
  ) {
    await queueRender(tabId, current.state);
    return;
  }

  rememberTabState(tabId, getStatusState(statusCode), {
    url,
    source: "navigation-timing",
    requestId: latestActive?.requestId || current?.requestId,
    obsoleteRequestIds:
      latestActive?.obsoleteRequestIds ?? current?.obsoleteRequestIds,
    documentId: sender.documentId || current?.documentId || "",
    navigationToken:
      latestActive?.navigationToken || current?.navigationToken || expectedNavigationToken
  });
});

async function handleBeforeNavigation(details) {
  const {
    tabId,
    frameId,
    url,
    documentId = "",
    timeStamp = Date.now()
  } = details;

  if (frameId !== 0 || !isOpenTabId(tabId) || isPrerender(details)) {
    return;
  }

  const active = activeRequests.get(tabId);

  if (active && active.timeStamp >= timeStamp) {
    return;
  }

  const current = tabStateCache.get(tabId) ?? await getRememberedTabState(tabId);
  const latestActive = activeRequests.get(tabId);

  if (!isOpenTabId(tabId)) {
    return;
  }

  if (latestActive && latestActive.timeStamp >= timeStamp) {
    return;
  }

  if (current?.updatedAt > timeStamp) {
    return;
  }

  const navigationToken = createNavigationToken(tabId);
  const obsoleteRequestIds = collectObsoleteRequestIds(
    current?.obsoleteRequestIds,
    current?.requestId,
    active?.obsoleteRequestIds,
    active?.requestId,
    latestActive?.obsoleteRequestIds,
    latestActive?.requestId
  );

  activeRequests.delete(tabId);
  navigationTokens.set(tabId, navigationToken);
  rememberTabState(tabId, NEUTRAL_STATE, {
    url,
    source: "webNavigation-pending",
    obsoleteRequestIds,
    documentId,
    navigationToken
  });
}

async function handleNavigationStage(details) {
  const { tabId, frameId, url, documentId = "" } = details;

  if (frameId !== 0 || isPrerender(details)) {
    return;
  }

  const allowHistory =
    details.documentLifecycle === "cached" ||
    details.transitionQualifiers?.includes("forward_back") === true;
  const expectedNavigationToken = getNavigationToken(tabId);

  await restoreTabState(
    tabId,
    url,
    documentId,
    allowHistory,
    expectedNavigationToken
  );
}

async function handleSameDocumentNavigation(details) {
  const { tabId, frameId, url, documentId = "" } = details;

  if (frameId !== 0 || !isOpenTabId(tabId) || isPrerender(details)) {
    return;
  }

  const expectedNavigationToken = getNavigationToken(tabId);
  const current = await getRememberedTabState(tabId);

  if (!isOpenTabId(tabId) || getNavigationToken(tabId) !== expectedNavigationToken) {
    return;
  }

  if (!current) {
    await restoreTabState(tabId, url, documentId, false, expectedNavigationToken);
    return;
  }

  rememberTabState(tabId, current.state, {
    url,
    source: current.source,
    requestId: current.requestId,
    obsoleteRequestIds: current.obsoleteRequestIds,
    documentId: documentId || current.documentId,
    navigationToken: current.navigationToken || expectedNavigationToken
  });
}

browser.webNavigation.onBeforeNavigate.addListener((details) => {
  handleBeforeNavigation(details).catch(() => undefined);
});

browser.webNavigation.onCommitted.addListener((details) => {
  if (!isPrerender(details)) {
    rememberCommittedNavigation(details);
  }

  handleNavigationStage(details).catch(() => undefined);
});

for (const event of [
  browser.webNavigation.onDOMContentLoaded,
  browser.webNavigation.onCompleted
]) {
  event.addListener((details) => {
    handleNavigationStage(details).catch(() => undefined);
  });
}

for (const event of [
  browser.webNavigation.onHistoryStateUpdated,
  browser.webNavigation.onReferenceFragmentUpdated
]) {
  event.addListener((details) => {
    handleSameDocumentNavigation(details).catch(() => undefined);
  });
}

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !isOpenTabId(tabId)) {
    return;
  }

  const expectedNavigationToken = getNavigationToken(tabId);

  rememberCommittedNavigation({ tabId, url: tab.url });
  await restoreTabState(tabId, tab.url, "", false, expectedNavigationToken);
  if (isOpenTabId(tabId)) {
    browser.tabs.sendMessage(tabId, { type: "report-navigation-status" }).catch(() => undefined);
  }
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const expectedNavigationToken = getNavigationToken(tabId);
  const tab = await browser.tabs.get(tabId).catch(() => null);

  if (tab && getNavigationToken(tabId) === expectedNavigationToken) {
    rememberCommittedNavigation({ tabId, url: tab.url });
    await restoreTabState(tabId, tab.url, "", false, expectedNavigationToken);
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  closedTabIds.add(tabId);
  tabStateCache.delete(tabId);
  tabHistoryCache.delete(tabId);
  activeRequests.delete(tabId);
  committedNavigations.delete(tabId);
  navigationTokens.delete(tabId);
  renderQueues.delete(tabId);
  renderVersions.delete(tabId);
  tabHistoryLoadTasks.delete(tabId);
  loadedTabHistoryIds.delete(tabId);
  queueStorageOperation(
    tabId,
    () => browser.storage.session.remove([
      getTabStateKey(tabId),
      getTabHistoryKey(tabId)
    ])
  ).catch(() => undefined);
});

browser.action.onClicked.addListener(() => {
  browser.tabs.create({ url: STATUS_CODES_URL }).catch(() => undefined);
});

Promise.all([
  browser.action.setIcon({ path: getIconPath(NEUTRAL_STATE) }),
  browser.action.setTitle({ title: NEUTRAL_STATE.title })
]).catch(() => undefined);
