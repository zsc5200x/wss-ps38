import { mergeLeagueOptionValue } from "./helpers.js";
import { mergeRow, mergeCrownRow } from "./rows.js";
import { el } from "../shared/dom.js";
import { state } from "../state.js";

function scoreClass(score) {
  const value = Number(score) || 0;
  return value >= 85 ? "high" : value >= 60 ? "medium" : "low";
}

export function renderLeagueBinding(league, source, mapping, pairedLeague, suggestions) {
  const section = el("div", `merge-league-binding${mapping ? " is-mapped" : " is-pending"}`);
  const leagueId = String(league.id);
  const crownLeagueId = source === "crown" ? leagueId : String(mapping?.crownId || "");
  const editing = source === "crown" && state.merge.editingLeagueIds.has(leagueId);
  const saving = source === "crown" && state.merge.leagueSavingCrownIds.has(leagueId);

  if (mapping && pairedLeague && !editing) {
    const summary = el("div", "merge-league-binding-summary");
    summary.append(el("span", "merge-status mapped", "联赛已绑定"));
    if (source === "crown") {
      const actions = el("div", "merge-league-actions");
      const change = el("button", "merge-action-button", "更换联赛");
      change.type = "button";
      change.dataset.mergeAction = "edit-league";
      change.dataset.crownLeagueId = leagueId;
      actions.append(change);
      const unmap = el("button", "merge-action-button danger", "解除联赛绑定");
      unmap.type = "button";
      unmap.dataset.mergeAction = "unmap-league";
      unmap.dataset.crownLeagueId = leagueId;
      unmap.disabled = saving;
      actions.append(unmap);
      summary.append(actions);
    }
    section.append(summary);
  } else if (source === "pinnacle") {
    section.append(el("span", "merge-status pending", "等待皇冠侧绑定联赛"));
    section.append(el("span", "merge-league-binding-help", "请先在皇冠视图确认对应联赛，再展开比赛。"));
  } else if (league.id === "--") {
    section.append(el("span", "merge-status pending", "联赛 ID 缺失"));
    section.append(el("span", "merge-league-binding-help", "缺少联赛 ID，暂时无法建立联赛映射。"));
  } else {
    const top = suggestions[0];
    if (top) {
      const card = el("div", "merge-league-candidate");
      const topRow = el("div", "merge-candidate-top");
      topRow.append(el("span", "merge-candidate-name", top.name));
      topRow.append(el("span", `merge-score-badge ${scoreClass(top.score)}`, `${Math.round(Number(top.score) || 0)}`));
      card.append(topRow);
      const reasons = Array.isArray(top.reasons) ? top.reasons.filter(Boolean) : [];
      const baseScore = Number(top.baseScore);
      const score = Number(top.score);
      if (Number.isFinite(baseScore) && Number.isFinite(score) && baseScore <= 85 && score > 85) {
        reasons.push(`基础分 ${baseScore}，国家/场次加成仅用于排序`);
      }
      const reasonText = reasons.join(" · ");
      if (reasonText) card.append(el("div", "merge-candidate-reasons", reasonText));
      const actions = el("div", "merge-candidate-actions");
      const confirm = el("button", "button primary merge-confirm-button", "确认此联赛");
      confirm.type = "button";
      confirm.dataset.mergeAction = "map-league-direct";
      confirm.dataset.crownLeagueId = leagueId;
      confirm.dataset.pinnacleLeagueId = String(top.id);
      confirm.disabled = saving;
      actions.append(confirm);
      card.append(actions);
      section.append(card);
    }

    const details = el("details", "merge-manual-picker");
    details.open = Boolean(mapping) || !top;
    details.append(el("summary", "", mapping ? "更换联赛绑定" : top ? "手动选择其他联赛" : "选择对应的平博联赛"));
    const form = el("div", "merge-league-bind-form");
    const label = el("label", "merge-picker-label", "选择对应的平博联赛");
    const inputId = `merge-pinnacle-league-${encodeURIComponent(leagueId)}`;
    label.htmlFor = inputId;
    form.append(label);
    const inputRow = el("div", "merge-picker-row");
    const input = el("input", "merge-picker merge-league-picker");
    input.type = "search";
    input.id = inputId;
    input.dataset.crownLeagueId = leagueId;
    input.setAttribute("list", "mergePinnacleLeagueOptions");
    input.setAttribute("autocomplete", "off");
    const selectedId = state.merge.selectedPinnacleLeagueByCrown.get(leagueId)
      || (mapping ? String(mapping.pinnacleId) : "");
    const selected = selectedId
      ? (state.merge.data?.pinnacleLeagues || []).find((item) => String(item.id) === selectedId)
      : null;
    if (selected) input.value = mergeLeagueOptionValue({
      id: String(selected.id),
      name: String(selected.name || "未命名联赛"),
      eventCount: Number(selected.eventCount || 0),
    });
    inputRow.append(input);
    const save = el("button", "button primary merge-confirm-button", mapping ? "保存联赛" : "确认联赛");
    save.type = "button";
    save.dataset.mergeAction = "map-league";
    save.dataset.crownLeagueId = leagueId;
    save.disabled = !selectedId || saving;
    inputRow.append(save);
    if (mapping) {
      const cancel = el("button", "merge-action-button", "取消");
      cancel.type = "button";
      cancel.dataset.mergeAction = "cancel-edit-league";
      cancel.dataset.crownLeagueId = leagueId;
      inputRow.append(cancel);
    }
    form.append(inputRow);
    const helper = el("div", "merge-picker-help");
    helper.dataset.mergeLeagueHelp = leagueId;
    helper.textContent = input.value
      ? "请确认皇冠与平博的联赛对应正确，再绑定比赛。"
      : "按联赛名或联赛 ID 搜索；可参考上方评分候选。";
    form.append(helper);

    const options = suggestions.slice(top ? 1 : 0, top ? 4 : 3);
    if (options.length) {
      const suggestionsBox = el("div", "merge-suggestions merge-league-suggestions");
      suggestionsBox.append(el("span", "merge-suggestions-label", "其他平博联赛候选"));
      for (const candidate of options) {
        const button = el("button", "merge-suggestion", `${candidate.name} · 联赛 ID ${candidate.id}`);
        button.type = "button";
        button.dataset.mergeAction = "choose-pinnacle-league";
        button.dataset.crownLeagueId = leagueId;
        button.dataset.pinnacleLeagueId = candidate.id;
        button.title = (Array.isArray(candidate.reasons) ? candidate.reasons : []).join(" · ");
        const score = Number(candidate.score);
        button.append(el("small", "merge-suggestion-score", `评分 ${Number.isFinite(score) ? Math.round(score) : 0}/100`));
        suggestionsBox.append(button);
      }
      form.append(suggestionsBox);
    }
    details.append(form);
    section.append(details);
  }

  return section;
}

export function renderMergeLeagueGroup(league, source, context) {
  const leagueId = String(league.id);
  const isCrown = source === "crown";
  const mapping = isCrown
    ? context.leagueMappingsByCrown.get(leagueId)
    : context.leagueMappingsByPinnacle.get(leagueId);
  const pairedLeague = mapping
    ? (isCrown
      ? context.pinnacleLeagueById.get(String(mapping.pinnacleId)) || mapping.pinnacleSnapshot
      : context.crownLeagueById.get(String(mapping.crownId)) || mapping.crownSnapshot)
    : null;
  const pairId = mapping ? String(isCrown ? mapping.pinnacleId : mapping.crownId) : "";
  const counterpartEvents = pairId
    ? (isCrown ? context.pinnacleEventsByLeague.get(pairId) : context.crownEventsByLeague.get(pairId)) || []
    : [];
  const open = state.merge.openLeagueBySource[source] === leagueId;
  const section = el("section", `merge-league-group${open ? " is-open" : ""}`);
  section.dataset.leagueId = leagueId;
  section.dataset.source = source;
  const sectionId = `merge-${source}-league-${encodeURIComponent(leagueId)}`;
  section.id = sectionId;

  const header = el("header", "merge-league-heading");
  const toggle = el("button", "merge-league-heading-toggle", "");
  toggle.type = "button";
  toggle.dataset.mergeAction = "toggle-league-events";
  toggle.dataset.source = source;
  toggle.dataset.leagueId = leagueId;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-controls", `${sectionId}-events`);
  toggle.disabled = !mapping;
  const identity = el("span", "merge-league-identity");
  identity.append(el("span", "merge-league-name", league.name));
  identity.append(el("span", "merge-league-id", `${isCrown ? "皇冠" : "平博"}联赛 ID ${leagueId}`));
  toggle.append(identity);
  if (mapping && pairedLeague) {
    const pair = el("span", "merge-league-identity merge-league-paired-identity");
    pair.append(el("span", "merge-league-name", pairedLeague.name));
    pair.append(el("span", "merge-league-id", `${isCrown ? "平博" : "皇冠"}联赛 ID ${pairedLeague.id}`));
    toggle.append(pair);
  }
  toggle.append(el("span", "merge-league-count", `${league.events.length} 场`));
  if (mapping) toggle.append(el("span", "merge-status mapped merge-league-status", "已绑定"));
  else toggle.append(el("span", "merge-status pending merge-league-status", "未绑定"));
  toggle.append(el("span", "merge-league-chevron", open ? "收起" : "展开"));
  header.append(toggle);
  section.append(header);

  const leagueCandidates = isCrown ? (context.leagueSuggestionsByCrown.get(leagueId) || []) : [];
  section.append(renderLeagueBinding(league, source, mapping, pairedLeague, leagueCandidates));
  if (mapping && pairId) {
    const eventToggleRow = el("div", "merge-league-events-toggle-row");
    const eventToggle = el("button", "merge-action-button merge-events-toggle", open ? "收起赛事" : `展开并绑定赛事 (${league.events.length})`);
    eventToggle.type = "button";
    eventToggle.dataset.mergeAction = "toggle-league-events";
    eventToggle.dataset.source = source;
    eventToggle.dataset.leagueId = leagueId;
    eventToggle.setAttribute("aria-expanded", String(open));
    eventToggleRow.append(eventToggle);
    if (counterpartEvents.length) eventToggleRow.append(el("span", "merge-league-binding-help", `对应联赛内 ${counterpartEvents.length} 场赛事`));
    section.append(eventToggleRow);
    const leagueMapped = league.events.filter((event) => {
      const id = String(event.id);
      return isCrown ? context.mappingsByCrown.has(id) : context.mappingsByPinnacle.has(id);
    }).length;
    const progressRow = el("div", "merge-league-progress-row");
    progressRow.append(el("span", "merge-league-progress-label", `已绑定 ${leagueMapped} / ${league.events.length} 场`));
    const progressBar = el("div", "merge-progress");
    const progressFill = el("span");
    progressFill.style.width = `${league.events.length ? (leagueMapped / league.events.length) * 100 : 0}%`;
    progressBar.append(progressFill);
    progressRow.append(progressBar);
    section.append(progressRow);
  }

  if (open && mapping && pairId) {
    const list = el("div", "merge-league-events");
    list.id = `${sectionId}-events`;
    const listId = isCrown ? "mergePinnacleOptions" : "mergeCrownOptions";
    const timeKey = isCrown ? "startLabel" : "kickoff";
    // Sort by the normalized Beijing kickoff, not each provider's raw zone.
    league.events.sort((a, b) => String(
      a.normalizedKickoff || a[timeKey] || ""
    ).localeCompare(String(b.normalizedKickoff || b[timeKey] || "")));
    for (const event of league.events) {
      if (isCrown) {
        list.append(mergeCrownRow(event, context.mappingsByCrown, context.pinnacleById,
          context.mappingsByPinnacle, context.suggestionsByCrown,
          new Set(counterpartEvents.map((item) => String(item.id))), listId));
      } else {
        const mappedCrownIds = new Set(counterpartEvents.map((item) => String(item.id)));
        const availableCrownIds = new Set(counterpartEvents
          .map((item) => String(item.id))
          .filter((id) => !context.mappingsByCrown.has(id)));
        if (context.mappingsByPinnacle.has(String(event.id))) {
          availableCrownIds.add(String(context.mappingsByPinnacle.get(String(event.id)).crownId));
        }
        list.append(mergeRow(event, context.mappingsByPinnacle, context.crownById,
          context.suggestionsByPinnacle, availableCrownIds, listId));
      }
    }
    section.append(list);
  }
  return section;
}
