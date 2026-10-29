(function exposeMailRefresh(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PersonalMailRefresh = api;
})(typeof window === "undefined" ? globalThis : window, function buildMailRefresh() {
  function createPersonalMailRefreshController(options) {
    const {
      fetchMail,
      onSuccess,
      onError = () => {},
      isVisible,
      isMailOpen,
      documentTarget,
      windowTarget,
      now = () => Date.now(),
      setIntervalFn = setInterval,
      clearIntervalFn = clearInterval,
      pollIntervalMs = 60_000,
      minimumRefreshMs = 5_000
    } = options;

    let inFlight = null;
    let lastStartedAt = Number.NEGATIVE_INFINITY;
    let requestVersion = 0;
    let appliedVersion = 0;
    let pollTimer = null;
    let started = false;

    function refresh(reason = "manual") {
      if (inFlight) return inFlight;
      if (now() - lastStartedAt < minimumRefreshMs) {
        return Promise.resolve({ skipped: "minimum-interval" });
      }

      lastStartedAt = now();
      const version = ++requestVersion;
      let fetched;
      try {
        fetched = fetchMail();
      } catch (error) {
        fetched = Promise.reject(error);
      }
      let request;
      request = Promise.resolve(fetched)
        .then(data => {
          if (version >= appliedVersion) {
            appliedVersion = version;
            onSuccess(data, reason);
          }
          return data;
        })
        .catch(error => {
          if (version >= appliedVersion) onError(error, reason);
          return { error };
        })
        .finally(() => {
          if (inFlight === request) inFlight = null;
        });

      inFlight = request;
      return request;
    }

    function stopPolling() {
      if (pollTimer === null) return;
      clearIntervalFn(pollTimer);
      pollTimer = null;
    }

    function syncPolling() {
      if (!isVisible() || !isMailOpen()) {
        stopPolling();
        return;
      }
      if (pollTimer === null) {
        pollTimer = setIntervalFn(() => refresh("poll"), pollIntervalMs);
      }
    }

    function handleVisibilityChange() {
      if (isVisible()) refresh("foreground");
      syncPolling();
    }

    function handlePageShow() {
      if (isVisible()) refresh("foreground");
      syncPolling();
    }

    function pageChanged() {
      if (isVisible() && isMailOpen()) refresh("mail-open");
      syncPolling();
    }

    function start() {
      if (started) return;
      started = true;
      documentTarget.addEventListener("visibilitychange", handleVisibilityChange);
      windowTarget.addEventListener("pageshow", handlePageShow);
      refresh("initial");
      syncPolling();
    }

    function stop() {
      if (!started) return;
      started = false;
      documentTarget.removeEventListener("visibilitychange", handleVisibilityChange);
      windowTarget.removeEventListener("pageshow", handlePageShow);
      stopPolling();
    }

    return {
      refresh,
      pageChanged,
      start,
      stop,
      isPolling: () => pollTimer !== null
    };
  }

  return { createPersonalMailRefreshController };
});
