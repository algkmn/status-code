function reportNavigationStatus() {
  let navigation;

  try {
    navigation = performance.getEntriesByType("navigation")[0];
  } catch {
    return;
  }

  const statusCode = Number(navigation?.responseStatus);

  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    return;
  }

  browser.runtime.sendMessage({
    type: "navigation-status",
    statusCode
  }).catch(() => undefined);
}

if (document.readyState === "complete") {
  reportNavigationStatus();
} else {
  window.addEventListener("load", reportNavigationStatus, { once: true });
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    reportNavigationStatus();
  }
});

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "report-navigation-status") {
    reportNavigationStatus();
  }
});
