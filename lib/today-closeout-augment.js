// lib/today-closeout-augment.js
// Surgical response augmenter for /api/today.
// It preserves the existing api/today.js handler and adds closeout_checklist
// only when the response body already looks like the Today dashboard JSON.

const http = require("http");
const { buildCloseoutChecklist } = require("./lifecycle");

let installed = false;

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
      nextChunk = tryAugmentBody(chunk, encoding);
      if (nextChunk !== chunk && typeof this.setHeader === "function") {
        this.setHeader("Content-Length", Buffer.byteLength(Buffer.isBuffer(nextChunk) ? nextChunk : String(nextChunk)));
      }
    } catch {
      nextChunk = chunk;
    }

    return originalEnd.call(this, nextChunk, encoding, callback);
  };
}

module.exports = { installTodayCloseoutAugmenter };
