import test from "node:test";
import assert from "node:assert/strict";
import { createConfirmedMarkets } from "../../crown/static/modules/confirmed-markets.js";

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[value]));

test("standalone Crown mode does not fetch or display confirmed Pinnacle markets", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw new Error("unexpected request"); });
  const view = createConfirmedMarkets({ enabled: false, escapeHtml });
  await view.load({ id: "9" }, true);
  assert.equal(requests, 0);
  assert.equal(view.get({ id: "9" }), null);
  assert.equal(view.renderMarkets({ pinnacle: { id: "101", odds: [] } }, {}), "");
  assert.equal(view.renderSummary({ pinnacle: { id: "101" } }, {}), "");
});

test("homepage loads only a confirmed mapping, throttles refresh and preserves live Crown data", async t => {
  let requests = 0;
  let changes = 0;
  const source = { dataUpdatedAt: "2026-10-30T00:00:00Z", status: "stale", cached: true };
  const item = { crownId: "9", pinnacleId: "101", crown: { home: "旧主队", markets: { old: true } }, pinnacle: { id: "101", odds: [{ market: "1", option: "0", hongKong: 0.98 }, { market: "1", option: "2", decimal: 2.10 }] } };
  t.mock.method(globalThis, "fetch", async url => {
    requests++;
    assert.equal(url, "/api/merge/confirmed?crownId=9");
    return new Response(JSON.stringify({ items: [item], sources: { pinnacle: source } }));
  });
  const view = createConfirmedMarkets({ enabled: true, escapeHtml, onChange: () => changes++ });
  const live = { id: "9", home: "当前主队", markets: { current: true } };
  await view.load(live);
  await view.load(live);
  assert.equal(requests, 1);
  assert.equal(changes, 1);
  const confirmed = view.get(live);
  assert.deepEqual(confirmed.sources.pinnacle, source);
  assert.deepEqual(view.mergeEvent(live, confirmed).markets, { current: true });
  const html = view.renderMarkets(confirmed, live);
  assert.match(html, /0\.980/);
  assert.doesNotMatch(html, /2\.100?/);
  assert.match(html, /已过期.*缓存/);
  assert.match(html, /当前主队/);
});

test("removed mappings clear cached confirmed data", async t => {
  const view = createConfirmedMarkets({ enabled: true, escapeHtml });
  let payload = { items: [{ crownId: "9", pinnacleId: "101" }] };
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(payload)));
  await view.load({ id: "9" }, true);
  assert.equal(view.get({ id: "9" }).pinnacleId, "101");
  payload = { items: [] };
  await view.load({ id: "9" }, true);
  assert.equal(view.get({ id: "9" }), null);
});
