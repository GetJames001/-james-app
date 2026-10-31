"use strict";

const DIAGNOSTIC_BRANCH = "fix/calendar-refresh-diagnosis-20261031";
const DIAGNOSTIC_KEY = "google:diagnostic:calendar-refresh-20261031:refresh_token";

// Only the diagnostic branch receives a separate grant. Never copy or fall back
// to the working connection, even when the diagnostic key does not exist.
function googleRefreshTokenKey(env = process.env) {
  if (env.VERCEL_ENV === "preview" && (typeof env.VERCEL_GIT_COMMIT_REF !== "string" || !env.VERCEL_GIT_COMMIT_REF.trim())) {
    throw new Error("Preview Calendar requires branch identity.");
  }
  if (env.VERCEL_GIT_COMMIT_REF === DIAGNOSTIC_BRANCH) {
    if (env.VERCEL_ENV !== "preview") throw new Error("Diagnostic Calendar requires Preview.");
    return DIAGNOSTIC_KEY;
  }
  return "google:refresh_token";
}
module.exports = {googleRefreshTokenKey, DIAGNOSTIC_BRANCH, DIAGNOSTIC_KEY};
