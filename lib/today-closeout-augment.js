// lib/today-closeout-augment.js
// Temporary, scoped /api/today response augmenter.
//
// Why this exists:
// api/today.js is currently large enough that direct connector edits are risky.
// This file lets VE OS expose closeout_checklist without rewriting that handler.
//
// Safety rules:
// - Install once only.
// - Only inspect responses for the exact /api/today route when the request URL is available.
// - Only alter JSON bodies that already match the Today dashboard response shape.
// - Preserve invalid JSON, non-JSON, non-Today responses, status codes, and headers.
// - Future maintainers should replace this with a direct api/today.js import of
//   buildCloseoutChecklist once api/today.js is small/safe enough to edit directly.

const http = require("http");
const { buildCloseoutChecklist } = require("./lifecycle");

let installed = false;

function looksLikeTodayRoute(res) {
  const reqUrl = String((res && res.req && res.req.url) || "").split("?")[0];
  return reqUrl === "/api/today";
}

function looksLikeTodayPayload(value) {
  return value &&
    value.ok === true &&
    value.owner_action_queue &&
    Array.isArray(value.timed_events) &&
    Array.isArray(value.week_days);
}

function tryAugmentBody(chunk, encoding) {
  if (!chunk) return chunk;

  const isBuffer = Buffer.isBuffer(chunk);
  const body = isBuffer
    ? chunk.toString(typeof encoding === "string" ? encoding : "utf8")
    : String(chunk);

  if (!body.includes("owner_action_queue") || body.includes("closeout_checklist")) return chunk;

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return chunk;
  }

  if (!looksLikeTodayPayload(parsed)) return chunk;

  parsed.closeout_checklist = buildCloseoutChecklist({
    ownerActionQueue: parsed.owner_action_queue,
    useOwnerQueueFallback: true,
  });

  const nextBody = JSON.stringify(parsed);
  return isBuffer ? Buffer.from(nextBody, typeof encoding === "string" ? encoding : "utf8") : nextBody;
}

function installTodayCloseoutAugmenter() {
  if (installed) return;
  installed = true;

  const originalEnd = http.ServerResponse.prototype.end;

  http.ServerResponse.prototype.end = function endWithTodayCloseout(chunk, encoding, callback) {
    let nextChunk = chunk;

    try {
      // This still wraps ServerResponse.end globally, but it only attempts
      // augmentation for /api/today and then only if the body shape matches.
      // api/today.js writes headers before res.end(), so do not set headers here.
      // Node will use chunked transfer when no Content-Length is present.
      if (looksLikeTodayRoute(this)) {
        nextChunk = tryAugmentBody(chunk, encoding);
      }
    } catch {
      nextChunk = chunk;
    }

    return originalEnd.call(this, nextChunk, encoding, callback);
  };
}

module.exports = { installTodayCloseoutAugmenter };
