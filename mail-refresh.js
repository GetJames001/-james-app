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
      pollIntervalMs = 30_000,
      refreshOnPageChange = true,
      minimumRefreshMs = 5_000
    } = options;

    let inFlight = null;
    let lastStartedAt = Number.NEGATIVE_INFINITY;
    let requestVersion = 0;
    let appliedVersion = 0;
    let pollTimer = null;
    let started = false;
    let epoch = 0;

    function refresh(reason = "manual") {
      if (inFlight) return inFlight;
      if (reason !== "inbox-button" && now() - lastStartedAt < minimumRefreshMs) {
        return Promise.resolve({ skipped: "minimum-interval" });
      }

      lastStartedAt = now();
      const version = ++requestVersion;
      const generation=epoch;
      let fetched;
      try {
        fetched = fetchMail(reason);
      } catch (error) {
        fetched = Promise.reject(error);
      }
      let request;
      request = Promise.resolve(fetched)
        .then(data => {
          if (generation===epoch && version >= appliedVersion) {
            appliedVersion = version;
            onSuccess(data, reason);
          }
          return data;
        })
        .catch(error => {
          if (generation===epoch && version >= appliedVersion) onError(error, reason);
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
      if (refreshOnPageChange && isVisible() && isMailOpen()) refresh("mail-open");
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
      epoch++;inFlight=null;
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
