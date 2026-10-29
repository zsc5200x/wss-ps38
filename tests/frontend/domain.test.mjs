import test from "node:test";
import assert from "node:assert/strict";
import { resolvePage } from "../../dashboard/static/modules/shared/routes.js";
import { quoteAgeInfo, historyRowLabel, leagueDisplayName, formatTotalLine } from "../../dashboard/static/modules/shared/format.js";
import { mergeEventTime, mergeMappedByPinnacle, mergeCrownById } from "../../dashboard/static/modules/merge/helpers.js";
import { describeSource } from "../../dashboard/static/modules/shared/source-status.js";
import { crownPinnaclePrice, crownPinnacleQuote } from "../../crown/static/modules/pinnacle-format.js";

test("existing pages resolve, and my-events remains its independent placeholder route", () => {
  for (const page of ["home", "pinnacle", "crown", "my-events", "merge", "settings"]) assert.equal(resolvePage(page), page);
  assert.equal(resolvePage("unknown"), "home");
});

test("homepage Pinnacle prices never fall back to decimal odds", () => {
  assert.equal(crownPinnaclePrice({ decimal: 1.95 }), "—");
  assert.equal(crownPinnaclePrice({ hongKong: 0.95, decimal: 8 }), "0.950");
  assert.equal(crownPinnaclePrice({ hongKong: 0.95, quoted: false }), "—");
  assert.equal(crownPinnaclePrice({ hongKongLabel: "0.88" }), "0.88");
});

test("handicap direction and split totals use the existing home/away semantics", () => {
  const event = { home: "主队甲", away: "客队乙" };
  assert.deepEqual(crownPinnacleQuote({ market: "2", option: "0", line: -0.5 }, event), { label: "主队甲 -0.5", line: "让球" });
  assert.deepEqual(crownPinnacleQuote({ market: "2", option: "1", line: -0.5 }, event), { label: "客队乙 +0.5", line: "受让" });
  assert.equal(crownPinnacleQuote({ market: "3", option: "3", line: 2.25 }, event).label, "大2/2.5");
  assert.equal(formatTotalLine(2.25), "2/2.5");
});

test("quote age depends on explicit source reference and handles missing capture time", () => {
  assert.deepEqual(quoteAgeInfo("2026-10-30T00:00:00Z", "2026-10-30T00:42:00Z"), { text: "42 分前", level: "aged", seconds: 2520 });
  assert.deepEqual(quoteAgeInfo(null, "2026-10-30T00:42:00Z"), { text: "时间未知", level: "unknown", seconds: null });
  assert.equal(historyRowLabel({ market: "1", stage: "0", option: "0" }, "甲 VS 乙"), "胜平负 · 全场 · 主胜");
  assert.equal(leagueDisplayName("国家 - U-20"), "国家U-20");
});

test("matching displays the normalized kickoff and keeps provider ID namespaces distinct", () => {
  assert.equal(mergeEventTime({ normalizedKickoff: "10-30 19:00", startLabel: "10-30 03:00" }, "crown"), "10-30 19:00");
  const data = { mappings: [{ pinnacleId: "101", crownId: "9" }], crownEvents: [{ id: "9" }] };
  assert.equal(mergeMappedByPinnacle(data).get("101").crownId, "9");
  assert.equal(mergeCrownById(data).has("101"), false);
});

test("source status never substitutes response generation time for source data time", () => {
  const missing = describeSource("皇冠", { status: "无数据", generatedAt: "2026-10-30T00:42:00Z", updatedAt: "2026-10-30T00:42:00Z" });
  assert.match(missing.text, /时间未知/);
  assert.equal(missing.level, "unknown");
  const stale = describeSource("平博", { status: "stale", cached: true, dataUpdatedAt: "2026-10-30T00:00:00Z" });
  assert.match(stale.text, /已过期.*缓存.*08:00:00 北京时间/);
  assert.equal(stale.level, "warning");
  assert.equal(describeSource("皇冠", { error: "会话同步失败" }).level, "error");
});
