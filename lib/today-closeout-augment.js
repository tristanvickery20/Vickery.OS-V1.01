// lib/today-closeout-augment.js
// Surgical response augmenter for /api/today.
// It preserves the existing api/today.js handler and adds closeout_checklist
// only when the JSON payload already looks like the Today dashboard response.

const { buildCloseoutChecklist } = require("./lifecycle");

let installed = false;

function looksLikeTodayPayload(value) {
  return value &&
    value.ok === true &&
    value.owner_action_queue &&
    Array.isArray(value.timed_events) &&
    Array.isArray(value.week_days);
}

function installTodayCloseoutAugmenter() {
  if (installed) return;
  installed = true;

  const originalStringify = JSON.stringify;

  JSON.stringify = function stringifyWithTodayCloseout(value, replacer, space) {
    try {
      if (looksLikeTodayPayload(value) && !value.closeout_checklist) {
        const augmented = {
          ...value,
          closeout_checklist: buildCloseoutChecklist({
            ownerActionQueue: value.owner_action_queue,
            useOwnerQueueFallback: true,
          }),
        };
        return originalStringify.call(JSON, augmented, replacer, space);
      }
    } catch {
      // Fail open: if augmentation ever errors, preserve the original response.
    }

    return originalStringify.call(JSON, value, replacer, space);
  };
}

module.exports = { installTodayCloseoutAugmenter };
