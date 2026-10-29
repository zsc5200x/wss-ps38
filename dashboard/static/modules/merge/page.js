import { describeSource } from "../shared/source-status.js";
import { fetchJson } from "../shared/http.js";
import { numberFormatter } from "../constants.js";
import { dom } from "../dom.js";
import { mergeTeams, mergeFixtureLabel, mergeEventTime, mergeEventRawTime, mergeCrownOptionValue, mergePinnacleOptionValue, mergeMappedByPinnacle, mergeCrownById, mergeLeagueOptionValue, mergeLeaguesForSource } from "./helpers.js";
import { renderMergeLeagueGroup } from "./leagues.js";
import { el, showToast } from "../shared/dom.js";
import { state } from "../state.js";

export function renderMergeWorkspace() {
  const data = state.merge.data;
  if (dom.mergeSourceStatus) {
    dom.mergeSourceStatus.replaceChildren(...[["crown", "皇冠"], ["pinnacle", "平博"]].map(([key, label]) => {
      const source = describeSource(label, data?.sources?.[key]);
      const item = el("span", "merge-source-status-item " + source.level, source.text);
      if (source.error) item.title = source.error;
      return item;
    }));
  }
  if (!dom.mergeGroups) return;
  dom.mergeError.classList.toggle("hidden", !state.merge.error);
  if (state.merge.error) dom.mergeError.textContent = state.merge.error;
  dom.mergeLoading.classList.toggle("hidden", !state.merge.loading || Boolean(data));
  if (!data) {
    dom.mergeGroups.replaceChildren();
    dom.mergeEmpty.classList.add("hidden");
    return;
  }
  const pinnacleEvents = Array.isArray(data.pinnacleEvents) ? data.pinnacleEvents : [];
  const crownEvents = Array.isArray(data.crownEvents) ? data.crownEvents : [];
  const mappings = mergeMappedByPinnacle(data);
  const mappingsByCrown = new Map((data.mappings || []).map((item) => [String(item.crownId), item]));
  const leagueMappings = Array.isArray(data.leagueMappings) ? data.leagueMappings : [];
  const leagueMappingsByCrown = new Map(leagueMappings.map((item) => [String(item.crownId), item]));
  const leagueMappingsByPinnacle = new Map(leagueMappings.map((item) => [String(item.pinnacleId), item]));
  const crownById = mergeCrownById(data);
  const pinnacleById = new Map(pinnacleEvents.map((item) => [String(item.id), item]));
  if (state.merge.optionsData !== data.crownEvents) {
    state.merge.optionsData = data.crownEvents;
    state.merge.optionByValue = new Map();
    const options = [];
    for (const event of crownEvents) {
      const id = String(event?.id || "");
      if (!id) continue;
      const value = mergeCrownOptionValue(event);
      state.merge.optionByValue.set(value, id);
      const option = el("option");
      option.value = value;
      options.push(option);
    }
    dom.mergeCrownOptions.replaceChildren(...options);
  }
  if (state.merge.pinnacleOptionsData !== data.pinnacleEvents) {
    state.merge.pinnacleOptionsData = data.pinnacleEvents;
    state.merge.pinnacleOptionByValue = new Map();
    const options = [];
    for (const event of pinnacleEvents) {
      const id = String(event?.id || "");
      if (!id) continue;
      const value = mergePinnacleOptionValue(event);
      state.merge.pinnacleOptionByValue.set(value, id);
      const option = el("option");
      option.value = value;
      options.push(option);
    }
    dom.mergePinnacleOptions.replaceChildren(...options);
  }
  const pinnacleLeagues = mergeLeaguesForSource(data, "pinnacle", pinnacleEvents);
  const crownLeagues = mergeLeaguesForSource(data, "crown", crownEvents);
  if (state.merge.leagueOptionsData !== data.pinnacleLeagues) {
    state.merge.leagueOptionsData = data.pinnacleLeagues;
    state.merge.leagueOptionByValue = new Map();
    const options = [];
    for (const league of pinnacleLeagues) {
      const id = String(league.id || "");
      if (!id || id === "--") continue;
      const value = mergeLeagueOptionValue(league);
      state.merge.leagueOptionByValue.set(value, id);
      const option = el("option");
      option.value = value;
      options.push(option);
    }
    dom.mergePinnacleLeagueOptions?.replaceChildren(...options);
  }
  const suggestions = new Map();
  const suggestionsByCrown = new Map();
  for (const suggestion of data.suggestions || []) {
    const id = String(suggestion.pinnacleId);
    if (!suggestions.has(id)) suggestions.set(id, []);
    suggestions.get(id).push(suggestion);
    const crownId = String(suggestion.crownId);
    if (!suggestionsByCrown.has(crownId)) suggestionsByCrown.set(crownId, []);
    suggestionsByCrown.get(crownId).push(suggestion);
  }
  for (const list of suggestions.values()) {
    list.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  }
  for (const list of suggestionsByCrown.values()) {
    list.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  }

  dom.mergePinnacleCount.textContent = numberFormatter.format(pinnacleEvents.length);
  dom.mergeCrownCount.textContent = numberFormatter.format(crownEvents.length);
  dom.mergeMappedCount.textContent = numberFormatter.format(mappings.size);
  const pendingCount = (state.merge.source === "crown" ? crownEvents.length : pinnacleEvents.length) - mappings.size;
  dom.mergePendingCount.textContent = numberFormatter.format(Math.max(0, pendingCount));
  for (const button of dom.mergeSourceButtons) {
    const active = button.dataset.mergeSource === state.merge.source;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  dom.mergeLoading.classList.toggle("hidden", !state.merge.loading || Boolean(data));

  const query = state.merge.search.trim().toLocaleLowerCase("zh-CN");
  const source = state.merge.source;
  const sourceEvents = source === "crown" ? crownEvents : pinnacleEvents;
  const filtered = sourceEvents.filter((event) => {
    const eventId = String(event.id);
    const mapping = source === "crown" ? mappingsByCrown.get(eventId) : mappings.get(eventId);
    const isMapped = Boolean(mapping);
    if (state.merge.filter === "pending" && isMapped) return false;
    if (state.merge.filter === "mapped" && !isMapped) return false;
    if (!query) return true;
    const pairedEvent = source === "crown"
      ? (mapping ? pinnacleById.get(String(mapping.pinnacleId)) || mapping.pinnacleSnapshot : null)
      : (mapping ? crownById.get(String(mapping.crownId)) || mapping.crownSnapshot : null);
    const suggestionText = source === "crown"
      ? (suggestionsByCrown.get(eventId) || [])
        .map((item) => mergeFixtureLabel(pinnacleById.get(String(item.pinnacleId)) || {})).join(" ")
      : (suggestions.get(eventId) || [])
        .map((item) => mergeFixtureLabel(crownById.get(String(item.crownId)) || {})).join(" ");
    const sourceTime = mergeEventTime(event, source);
    const pairedSource = source === "crown" ? "pinnacle" : "crown";
    const pairedTime = pairedEvent ? mergeEventTime(pairedEvent, pairedSource) : "";
    const searchText = [event.id, event.leagueId, event.league, event.name, ...mergeTeams(event), sourceTime,
      mergeEventRawTime(event, source),
      mapping?.pinnacleId, mapping?.crownId, pairedEvent?.id, pairedEvent?.leagueId,
      pairedEvent?.league, pairedEvent?.name, ...mergeTeams(pairedEvent || {}), pairedTime,
      mergeEventRawTime(pairedEvent || {}, pairedSource), suggestionText]
      .filter(Boolean).join(" ").toLocaleLowerCase("zh-CN");
    return searchText.includes(query);
  });

  dom.mergeGroups.replaceChildren();
  const sourceName = source === "crown" ? "皇冠" : "平博";
  const hasData = sourceEvents.length > 0;
  const noResults = !filtered.length;
  dom.mergeEmpty.classList.toggle("hidden", hasData && !noResults);
  if (!hasData) {
    dom.mergeEmpty.textContent = `当前没有可显示的${sourceName}赛事。请确认${sourceName}数据已连接后刷新。`;
    dom.mergeEmpty.classList.remove("hidden");
    return;
  }
  if (noResults) {
    dom.mergeEmpty.textContent = "没有符合当前搜索和筛选条件的赛事。";
    dom.mergeEmpty.classList.remove("hidden");
    return;
  }

  const filteredById = new Set(filtered.map((event) => String(event.id)));
  const sourceLeagues = source === "crown" ? crownLeagues : pinnacleLeagues;
  const leagues = sourceLeagues
    .map((league) => ({ ...league, events: (league.events || []).filter((event) => filteredById.has(String(event.id))) }))
    .filter((league) => league.events.length)
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN") || String(a.id).localeCompare(String(b.id), "zh-CN"));
  const context = {
    leagueMappingsByCrown,
    leagueMappingsByPinnacle,
    crownLeagueById: new Map(crownLeagues.map((item) => [String(item.id), item])),
    pinnacleLeagueById: new Map(pinnacleLeagues.map((item) => [String(item.id), item])),
    crownEventsByLeague: new Map(crownLeagues.map((item) => [String(item.id), item.events || []])),
    pinnacleEventsByLeague: new Map(pinnacleLeagues.map((item) => [String(item.id), item.events || []])),
    leagueSuggestionsByCrown: new Map(),
    mappingsByCrown,
    mappingsByPinnacle: mappings,
    crownById,
    pinnacleById,
    suggestionsByCrown,
    suggestionsByPinnacle: suggestions,
  };
  for (const item of data.leagueSuggestions || []) {
    const crownId = String(item.crownLeagueId || "");
    if (!crownId) continue;
    if (!context.leagueSuggestionsByCrown.has(crownId)) context.leagueSuggestionsByCrown.set(crownId, []);
    context.leagueSuggestionsByCrown.get(crownId).push({
      id: String(item.pinnacleLeagueId || ""),
      name: context.pinnacleLeagueById.get(String(item.pinnacleLeagueId || ""))?.name
        || String(item.pinnacleLeagueName || "未命名联赛"),
      score: item.score,
      reasons: item.reasons,
    });
  }
  for (const list of context.leagueSuggestionsByCrown.values()) {
    list.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  }
  for (const league of leagues) {
    dom.mergeGroups.append(renderMergeLeagueGroup(league, source, context));
  }
}

export async function refreshMerge(force = false) {
  if (!dom.mergeGroups || state.merge.loading) return;
  if (!force && Date.now() - state.merge.lastFetchAt < 15000) return;
  state.merge.loading = true;
  state.merge.error = "";
  const requestSerial = ++state.merge.requestSerial;
  if (!state.merge.data) dom.mergeLoading.classList.remove("hidden");
  try {
    const { response, payload } = await fetchJson("/api/merge", { cache: "no-store" }, { timeoutMs: 15000 });

    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || "赛事列表读取失败");
    }
    if (requestSerial !== state.merge.requestSerial) return;
    state.merge.data = payload;
    state.merge.error = payload.crownError
      ? `皇冠赛事读取失败：${payload.crownError}`
      : "";
    state.merge.lastFetchAt = Date.now();
    renderMergeWorkspace();
  } catch (error) {
    if (requestSerial !== state.merge.requestSerial) return;
    state.merge.error = `读取赛事失败：${error.message || "请确认平博和皇冠服务正常后重试。"}`;
    renderMergeWorkspace();
  } finally {
    if (requestSerial === state.merge.requestSerial) {
      state.merge.loading = false;
      dom.mergeLoading.classList.add("hidden");
    }
  }
}

export async function saveMergeMapping(action, pinnacleId, crownId = "") {
  const id = String(pinnacleId || "");
  if (!id || state.merge.savingPinnacleIds.has(id)) return;
  state.merge.savingPinnacleIds.add(id);
  renderMergeWorkspace();
  try {
    const { response, payload } = await fetchJson("/api/merge/mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, pinnacleId: id, ...(action === "map" ? { crownId } : {}) }),
    }, { timeoutMs: 15000 });

    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || "保存合并关系失败");
    }
    state.merge.selectedCrownByPinnacle.delete(id);
    state.merge.editingPinnacleIds.delete(id);
    state.merge.lastFetchAt = 0;
    await refreshMerge(true);
    showToast(action === "unmap" ? "已解除赛事关联" : "赛事关联已保存");
  } catch (error) {
    showToast(`保存失败：${error.message || "请重试"}`);
  } finally {
    state.merge.savingPinnacleIds.delete(id);
    renderMergeWorkspace();
  }
}

export async function saveMergeLeagueMapping(action, crownLeagueId, pinnacleLeagueId = "") {
  const crownId = String(crownLeagueId || "");
  if (!crownId || state.merge.leagueSavingCrownIds.has(crownId)) return;
  state.merge.leagueSavingCrownIds.add(crownId);
  renderMergeWorkspace();
  try {
    const { response, payload } = await fetchJson("/api/merge/league-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        crownLeagueId: crownId,
        ...(action === "map" ? { pinnacleLeagueId: String(pinnacleLeagueId || "") } : {}),
      }),
    }, { timeoutMs: 15000 });

    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.error || "保存联赛绑定失败");
    }
    state.merge.selectedPinnacleLeagueByCrown.delete(crownId);
    state.merge.editingLeagueIds.delete(crownId);
    if (action === "map") {
      state.merge.openLeagueBySource.crown = crownId;
    } else if (state.merge.openLeagueBySource.crown === crownId) {
      state.merge.openLeagueBySource.crown = "";
    }
    state.merge.lastFetchAt = 0;
    await refreshMerge(true);
    showToast(action === "unmap" ? "已解除联赛绑定" : "联赛绑定已保存，现在可以绑定赛事");
  } catch (error) {
    showToast(`保存失败：${error.message || "请重试"}`);
  } finally {
    state.merge.leagueSavingCrownIds.delete(crownId);
    renderMergeWorkspace();
  }
}
