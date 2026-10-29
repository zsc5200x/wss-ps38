import { mergeTeams, mergeFixtureLabel, mergeEventTime, mergeEventRawTime, mergeCrownOptionValue, mergePinnacleOptionValue } from "./helpers.js";
import { el } from "../shared/dom.js";
import { state } from "../state.js";

export function mergeSourceBlock(source, event) {
  const [home, away] = mergeTeams(event);
  const isPinnacle = source === "pinnacle";
  const idLabel = isPinnacle ? "赛事 ID" : "赛事 ID";
  const leagueId = String(event?.leagueId || "--");
  const eventId = String(event?.id || "--");
  const sourceKind = isPinnacle ? "pinnacle" : "crown";
  const time = mergeEventTime(event, sourceKind);
  const rawTime = mergeEventRawTime(event, sourceKind);
  const block = el("div", `merge-source merge-source-${source}`);
  const top = el("div", "merge-source-top");
  top.append(el("span", "merge-source-label", isPinnacle ? "平博" : "皇冠"));
  top.append(el("span", "merge-source-league", String(event?.league || "未命名联赛")));
  block.append(top);
  block.append(el("strong", "merge-source-teams", [home, away].filter(Boolean).join(" vs ") || "赛事名称待补全"));
  const details = el("div", "merge-source-details");
  details.append(el("span", "merge-source-time", time));
  if (rawTime && rawTime !== time) {
    details.append(el("span", "merge-id-pair", `原始时间 ${rawTime}`));
  }
  details.append(el("span", "merge-id-pair", `${idLabel} ${eventId}`));
  details.append(el("span", "merge-id-pair", `联赛 ID ${leagueId}`));
  if (!isPinnacle && event?.score) details.append(el("span", "merge-id-pair", `比分 ${event.score}`));
  if (!isPinnacle && event?.minute) details.append(el("span", "merge-id-pair", String(event.minute)));
  block.append(details);
  return block;
}

export function mergeSuggestionReasons(suggestion) {
  const reasons = Array.isArray(suggestion?.reasons) ? suggestion.reasons.filter(Boolean) : [];
  if (reasons.length) return reasons.join(" · ");
  const confidence = String(suggestion?.confidence || "");
  return confidence === "high" ? "队名与赛事信息较接近" : "候选需人工核对";
}

export function mergeRow(pinnacle, mappings, crownById, suggestions, availableCrownIds, optionsListId = "mergeCrownOptions") {
  const pinnacleId = String(pinnacle.id);
  const mapping = mappings.get(pinnacleId);
  const mappedCrown = mapping
    ? (crownById.get(String(mapping.crownId)) || mapping.crownSnapshot || null)
    : null;
  const editing = state.merge.editingPinnacleIds.has(pinnacleId);
  const selectedCrownId = state.merge.selectedCrownByPinnacle.get(pinnacleId) || "";
  const row = el("article", `merge-row${mapping ? " is-mapped" : " is-pending"}`);
  row.dataset.pinnacleId = pinnacleId;
  row.append(mergeSourceBlock("pinnacle", pinnacle));

  const target = el("div", "merge-target");
  if (mapping && mappedCrown && !editing) {
    const heading = el("div", "merge-target-heading");
    heading.append(el("span", "merge-status mapped", "已确认关联"));
    target.append(heading, mergeSourceBlock("crown", mappedCrown));
    const actions = el("div", "merge-row-actions");
    const changeButton = el("button", "merge-action-button", "更换关联");
    changeButton.type = "button";
    changeButton.dataset.mergeAction = "edit";
    changeButton.dataset.pinnacleId = pinnacleId;
    actions.append(changeButton);
    const unmapButton = el("button", "merge-action-button danger", "解除关联");
    unmapButton.type = "button";
    unmapButton.dataset.mergeAction = "unmap";
    unmapButton.dataset.pinnacleId = pinnacleId;
    unmapButton.disabled = state.merge.savingPinnacleIds.has(pinnacleId);
    actions.append(unmapButton);
    target.append(actions);
    row.append(target);
    return row;
  }

  const heading = el("div", "merge-target-heading");
  heading.append(el("span", `merge-status ${mapping ? "pending" : "pending"}`, mapping ? "正在更换关联" : "待人工确认"));
  if (mapping) {
    const cancel = el("button", "merge-text-button", "取消");
    cancel.type = "button";
    cancel.dataset.mergeAction = "cancel-edit";
    cancel.dataset.pinnacleId = pinnacleId;
    heading.append(cancel);
  }
  target.append(heading);

  const candidateBox = el("div", "merge-candidate-box");
  const label = el("label", "merge-picker-label", "选择对应的皇冠赛事");
  label.htmlFor = `merge-crown-picker-${pinnacleId}`;
  candidateBox.append(label);

  const rowSuggestions = (suggestions.get(pinnacleId) || [])
    .filter((item) => availableCrownIds.has(String(item.crownId)))
    .slice(0, 5);

  const input = el("input", "merge-picker");
  input.type = "search";
  input.id = `merge-crown-picker-${pinnacleId}`;
  input.setAttribute("list", optionsListId);
  input.setAttribute("autocomplete", "off");
  input.dataset.pinnacleId = pinnacleId;
  const initialId = selectedCrownId || (mapping ? String(mapping.crownId) : "");
  const initialEvent = crownById.get(initialId);
  if (initialEvent) input.value = mergeCrownOptionValue(initialEvent);
  const inputRow = el("div", "merge-picker-row");
  inputRow.append(input);
  const save = el("button", "button primary merge-confirm-button", mapping ? "保存关联" : "确认关联");
  save.type = "button";
  save.dataset.mergeAction = "map";
  save.dataset.pinnacleId = pinnacleId;
  save.disabled = !initialId || state.merge.savingPinnacleIds.has(pinnacleId);
  inputRow.append(save);
  candidateBox.append(inputRow);

  const helper = el("div", "merge-picker-help");
  helper.dataset.mergeHelp = pinnacleId;
  helper.textContent = "可按队名、联赛或赛事 ID 搜索皇冠赛事；核对联赛和开赛时间后再确认。";
  candidateBox.append(helper);

  if (rowSuggestions.length) {
    const suggestionList = el("div", "merge-suggestions");
    suggestionList.append(el("span", "merge-suggestions-label", "候选"));
    for (const suggestion of rowSuggestions.slice(0, 3)) {
      const event = crownById.get(String(suggestion.crownId));
      if (!event) continue;
      const optionButton = el("button", "merge-suggestion", mergeFixtureLabel(event));
      optionButton.type = "button";
      optionButton.dataset.mergeAction = "choose";
      optionButton.dataset.pinnacleId = pinnacleId;
      optionButton.dataset.crownId = String(event.id);
      optionButton.title = mergeSuggestionReasons(suggestion);
      const score = Number(suggestion.score);
      const scoreText = Number.isFinite(score) ? `评分 ${Math.round(score)}/100` : "候选";
      optionButton.append(el("small", "merge-suggestion-score", scoreText));
      suggestionList.append(optionButton);
    }
    if (suggestionList.children.length > 1) candidateBox.append(suggestionList);
  }

  target.append(candidateBox);
  row.append(target);
  return row;
}

export function mergeCrownRow(crown, mappingsByCrown, pinnacleById, mappingsByPinnacle, suggestions, allowedPinnacleIds, optionsListId = "mergePinnacleOptions") {
  const crownId = String(crown.id);
  const mapping = mappingsByCrown.get(crownId);
  const pinnacle = mapping
    ? (pinnacleById.get(String(mapping.pinnacleId)) || mapping.pinnacleSnapshot || null)
    : null;
  const row = el("article", `merge-row merge-crown-row${mapping ? " is-mapped" : " is-pending"}`);
  row.dataset.crownId = crownId;
  row.append(mergeSourceBlock("crown", crown));

  const target = el("div", "merge-target");
  if (mapping && pinnacle) {
    const heading = el("div", "merge-target-heading");
    heading.append(el("span", "merge-status mapped", "已确认关联"));
    target.append(heading, mergeSourceBlock("pinnacle", pinnacle));
    const actions = el("div", "merge-row-actions");
    const unmapButton = el("button", "merge-action-button danger", "解除关联");
    unmapButton.type = "button";
    unmapButton.dataset.mergeAction = "unmap";
    unmapButton.dataset.pinnacleId = String(mapping.pinnacleId);
    unmapButton.disabled = state.merge.savingPinnacleIds.has(String(mapping.pinnacleId));
    actions.append(unmapButton);
    target.append(actions);
    row.append(target);
    return row;
  }

  const heading = el("div", "merge-target-heading");
  heading.append(el("span", "merge-status pending", "待人工确认"));
  target.append(heading);

  const candidateBox = el("div", "merge-candidate-box");
  const label = el("label", "merge-picker-label", "选择对应的平博赛事");
  label.htmlFor = `merge-pinnacle-picker-${crownId}`;
  candidateBox.append(label);

  const selectedPinnacleId = state.merge.selectedPinnacleByCrown.get(crownId) || "";
  const selectedPinnacle = pinnacleById.get(selectedPinnacleId);
  const input = el("input", "merge-picker merge-pinnacle-picker");
  input.type = "search";
  input.id = `merge-pinnacle-picker-${crownId}`;
  input.setAttribute("list", optionsListId);
  input.setAttribute("autocomplete", "off");
  input.dataset.crownId = crownId;
  if (selectedPinnacle) input.value = mergePinnacleOptionValue(selectedPinnacle);

  const inputRow = el("div", "merge-picker-row");
  inputRow.append(input);
  const save = el("button", "button primary merge-confirm-button", "确认关联");
  save.type = "button";
  save.dataset.mergeAction = "map-from-crown";
  save.dataset.crownId = crownId;
  const selectedMapping = selectedPinnacleId ? mappingsByPinnacle.get(selectedPinnacleId) : null;
  save.disabled = !selectedPinnacleId || (selectedMapping && String(selectedMapping.crownId) !== crownId)
    || state.merge.savingPinnacleIds.has(selectedPinnacleId);
  inputRow.append(save);
  candidateBox.append(inputRow);

  const helper = el("div", "merge-picker-help");
  helper.dataset.mergeCrownHelp = crownId;
  helper.textContent = selectedMapping && String(selectedMapping.crownId) !== crownId
    ? "这场平博赛事已关联其他皇冠赛事，请先在平博视图解除原关联。"
    : "可按队名、联赛或赛事 ID 搜索平博赛事；核对联赛和开赛时间后再确认。";
  candidateBox.append(helper);

  const rowSuggestions = (suggestions.get(crownId) || [])
    .filter((item) => allowedPinnacleIds.has(String(item.pinnacleId)))
    .filter((item) => !mappingsByPinnacle.has(String(item.pinnacleId)))
    .slice(0, 3);
  if (rowSuggestions.length) {
    const suggestionList = el("div", "merge-suggestions");
    suggestionList.append(el("span", "merge-suggestions-label", "候选平博赛事"));
    for (const suggestion of rowSuggestions) {
      const item = pinnacleById.get(String(suggestion.pinnacleId));
      if (!item) continue;
      const optionButton = el("button", "merge-suggestion", mergeFixtureLabel(item));
      optionButton.type = "button";
      optionButton.dataset.mergeAction = "choose-pinnacle";
      optionButton.dataset.crownId = crownId;
      optionButton.dataset.pinnacleId = String(item.id);
      optionButton.title = mergeSuggestionReasons(suggestion);
      const score = Number(suggestion.score);
      const scoreText = Number.isFinite(score) ? `评分 ${Math.round(score)}/100` : "候选";
      optionButton.append(el("small", "merge-suggestion-score", scoreText));
      suggestionList.append(optionButton);
    }
    if (suggestionList.children.length) candidateBox.append(suggestionList);
  }

  target.append(candidateBox);
  row.append(target);
  return row;
}
