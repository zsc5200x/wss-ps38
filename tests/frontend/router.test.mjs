import test from "node:test";
import assert from "node:assert/strict";

const messages = [];
function frame(page, source) {
  return {
    dataset: { src: source },
    contentWindow: { postMessage: (message, origin) => messages.push({ page, message, origin }) },
    closest: () => ({ dataset: { pagePanel: page } }),
  };
}
const home = frame("home", "/crown?embed=1&fixtures=1");
const crown = frame("crown", "/crown?embed=1");
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: selector => selector === "[data-crown-frame]" ? [home, crown] : [],
  querySelector: () => null,
};
globalThis.location = { origin: "http://127.0.0.1:8787" };
const { state } = await import("../../dashboard/static/modules/state.js");
const { activeCrownFrame, ensureCrownFrameLoaded, syncCrownFrameActivity } = await import("../../dashboard/static/modules/router.js");

test("Crown iframes lazy load their own views and only the active one polls", () => {
  state.currentPage = "home";
  assert.equal(activeCrownFrame(), home);
  ensureCrownFrameLoaded();
  assert.equal(home.src, "/crown?embed=1&fixtures=1");
  assert.equal(crown.src, undefined);
  syncCrownFrameActivity();
  assert.deepEqual(messages.at(-1), { page: "home", message: { type: "crown:command", command: "set-paused", paused: false }, origin: location.origin });

  state.currentPage = "crown";
  ensureCrownFrameLoaded();
  syncCrownFrameActivity();
  assert.equal(crown.src, "/crown?embed=1");
  assert.deepEqual(messages.slice(-2).map(item => [item.page, item.message.paused]), [["home", true], ["crown", false]]);

  state.currentPage = "my-events";
  syncCrownFrameActivity();
  assert.equal(activeCrownFrame(), null);
  assert.deepEqual(messages.slice(-2).map(item => item.message.paused), [true, true]);
});
