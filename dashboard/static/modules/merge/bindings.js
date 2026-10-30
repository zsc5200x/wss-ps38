import { dom } from "../dom.js";
import { mergeCrownOptionValue, mergePinnacleOptionValue, mergeMappedByPinnacle, mergeCrownById, mergeLeagueOptionValue } from "./helpers.js";
import { renderMergeWorkspace, refreshMerge, saveMergeMapping, saveMergeLeagueMapping } from "./page.js";
import { showToast } from "../shared/dom.js";
import { state } from "../state.js";

export function bindMergeEvents() {
  dom.mergeRefreshButton?.addEventListener("click", () => {
    refreshMerge(true);
  });

  for (const button of dom.mergeSourceButtons) {
    button.addEventListener("click", () => {
      state.merge.source = button.dataset.mergeSource === "pinnacle" ? "pinnacle" : "crown";
      state.merge.search = "";
      state.merge.filter = "all";
      if (dom.mergeSearch) dom.mergeSearch.value = "";
      for (const filter of dom.mergeFilters?.querySelectorAll("[data-merge-filter]") || []) {
        const active = filter.dataset.mergeFilter === "all";
        filter.classList.toggle("active", active);
        filter.setAttribute("aria-pressed", String(active));
      }
      renderMergeWorkspace();
    });
  }

  dom.mergeSearch?.addEventListener("input", () => {
    state.merge.search = dom.mergeSearch.value;
    const cursor = dom.mergeSearch.selectionStart;
    renderMergeWorkspace();
    dom.mergeSearch.focus();
    if (cursor !== null) dom.mergeSearch.setSelectionRange(cursor, cursor);
  });

  dom.mergeFilters?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-merge-filter]");
    if (!button) return;
    state.merge.filter = button.dataset.mergeFilter;
    for (const filter of dom.mergeFilters.querySelectorAll("[data-merge-filter]")) {
      const active = filter === button;
      filter.classList.toggle("active", active);
      filter.setAttribute("aria-pressed", String(active));
    }
    renderMergeWorkspace();
  });

  dom.mergeGroups?.addEventListener("input", (event) => {
    const leagueInput = event.target.closest(".merge-league-picker");
    if (leagueInput) {
      const crownLeagueId = String(leagueInput.dataset.crownLeagueId || "");
      const selectedPinnacleLeagueId = state.merge.leagueOptionByValue.get(leagueInput.value.trim()) || "";
      if (selectedPinnacleLeagueId) {
        state.merge.selectedPinnacleLeagueByCrown.set(crownLeagueId, selectedPinnacleLeagueId);
      } else {
        state.merge.selectedPinnacleLeagueByCrown.delete(crownLeagueId);
      }
      const form = leagueInput.closest(".merge-league-bind-form");
      const saveButton = form?.querySelector('[data-merge-action="map-league"]');
      if (saveButton) saveButton.disabled = !selectedPinnacleLeagueId || state.merge.leagueSavingCrownIds.has(crownLeagueId);
      const help = form?.querySelector("[data-merge-league-help]");
      if (help) {
        help.textContent = selectedPinnacleLeagueId
          ? "请确认皇冠与平博的联赛对应正确，再绑定比赛。"
          : leagueInput.value
            ? "请从下拉候选中选择完整联赛，或继续输入关键词缩小列表。"
            : "按联赛名或联赛 ID 搜索；可参考下方评分候选。";
      }
      return;
    }
    const input = event.target.closest("[data-pinnacle-id].merge-picker");
    if (input) {
      const id = input.dataset.pinnacleId;
      const selectedCrownId = state.merge.optionByValue.get(input.value.trim()) || "";
      const mappings = mergeMappedByPinnacle(state.merge.data);
      const occupiedBy = selectedCrownId
        ? [...mappings.values()].find((mapping) =>
          String(mapping.crownId) === selectedCrownId && String(mapping.pinnacleId) !== id,
        )
        : null;
      const canSelect = Boolean(selectedCrownId && !occupiedBy);
      if (canSelect) state.merge.selectedCrownByPinnacle.set(id, selectedCrownId);
      else state.merge.selectedCrownByPinnacle.delete(id);
      const row = input.closest(".merge-row");
      const saveButton = row?.querySelector('[data-merge-action="map"]');
      if (saveButton) saveButton.disabled = !canSelect || state.merge.savingPinnacleIds.has(id);
      const help = row?.querySelector(".merge-picker-help");
      if (help) {
        help.textContent = occupiedBy
          ? "这场皇冠赛事已关联到另一场平博赛事，请选择其他候选。"
          : input.value && !canSelect
            ? "请从下拉候选中选择完整赛事，或继续输入关键词缩小列表。"
            : "可按队名、联赛或赛事 ID 搜索皇冠赛事；核对联赛和开赛时间后再确认。";
      }
      return;
    }

    const crownInput = event.target.closest("[data-crown-id].merge-pinnacle-picker");
    if (!crownInput) return;
    const crownId = crownInput.dataset.crownId;
    const selectedPinnacleId = state.merge.pinnacleOptionByValue.get(crownInput.value.trim()) || "";
    const mappings = mergeMappedByPinnacle(state.merge.data);
    const occupiedBy = selectedPinnacleId ? mappings.get(selectedPinnacleId) : null;
    const canSelect = Boolean(selectedPinnacleId && (!occupiedBy || String(occupiedBy.crownId) === crownId));
    if (canSelect) state.merge.selectedPinnacleByCrown.set(crownId, selectedPinnacleId);
    else state.merge.selectedPinnacleByCrown.delete(crownId);
    const row = crownInput.closest(".merge-row");
    const saveButton = row?.querySelector('[data-merge-action="map-from-crown"]');
    if (saveButton) saveButton.disabled = !canSelect || state.merge.savingPinnacleIds.has(selectedPinnacleId);
    const help = row?.querySelector("[data-merge-crown-help]");
    if (help) {
      help.textContent = occupiedBy
        ? "这场平博赛事已关联其他皇冠赛事，请先在平博视图解除原关联。"
        : crownInput.value && !canSelect
          ? "请从下拉候选中选择完整赛事，或继续输入关键词缩小列表。"
          : "可按队名、联赛或赛事 ID 搜索平博赛事；核对联赛和开赛时间后再确认。";
    }
  });

  dom.mergeGroups?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-merge-action]");
    if (!button) return;
    const pinnacleId = String(button.dataset.pinnacleId || "");
    const action = button.dataset.mergeAction;
    if (action === "toggle-league-events") {
      const source = button.dataset.source === "pinnacle" ? "pinnacle" : "crown";
      const leagueId = String(button.dataset.leagueId || "");
      const mapping = source === "crown"
        ? new Map((state.merge.data?.leagueMappings || []).map((item) => [String(item.crownId), item])).get(leagueId)
        : new Map((state.merge.data?.leagueMappings || []).map((item) => [String(item.pinnacleId), item])).get(leagueId);
      if (!mapping) return;
      state.merge.openLeagueBySource[source] = state.merge.openLeagueBySource[source] === leagueId ? "" : leagueId;
      renderMergeWorkspace();
      return;
    }
    if (action === "choose-pinnacle-league") {
      const crownLeagueId = String(button.dataset.crownLeagueId || "");
      const pinnacleLeagueId = String(button.dataset.pinnacleLeagueId || "");
      const league = (state.merge.data?.pinnacleLeagues || []).find((item) => String(item.id) === pinnacleLeagueId);
      if (crownLeagueId && pinnacleLeagueId) {
        state.merge.selectedPinnacleLeagueByCrown.set(crownLeagueId, pinnacleLeagueId);
        renderMergeWorkspace();
        const picker = document.getElementById(`merge-pinnacle-league-${encodeURIComponent(crownLeagueId)}`);
        if (picker && league) {
          picker.value = mergeLeagueOptionValue(league);
          picker.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      return;
    }
    if (action === "edit-league") {
      const crownLeagueId = String(button.dataset.crownLeagueId || "");
      state.merge.editingLeagueIds.add(crownLeagueId);
      renderMergeWorkspace();
      return;
    }
    if (action === "cancel-edit-league") {
      const crownLeagueId = String(button.dataset.crownLeagueId || "");
      state.merge.editingLeagueIds.delete(crownLeagueId);
      state.merge.selectedPinnacleLeagueByCrown.delete(crownLeagueId);
      renderMergeWorkspace();
      return;
    }
    if (action === "map-league") {
      const crownLeagueId = String(button.dataset.crownLeagueId || "");
      const pinnacleLeagueId = state.merge.selectedPinnacleLeagueByCrown.get(crownLeagueId) || "";
      if (!pinnacleLeagueId) {
        showToast("请先选择对应的平博联赛");
        return;
      }
      saveMergeLeagueMapping("map", crownLeagueId, pinnacleLeagueId);
      return;
    }
    if (action === "map-league-direct") {
      const crownLeagueId = String(button.dataset.crownLeagueId || "");
      const pinnacleLeagueId = String(button.dataset.pinnacleLeagueId || "");
      if (!crownLeagueId || !pinnacleLeagueId) return;
      saveMergeLeagueMapping("map", crownLeagueId, pinnacleLeagueId);
      return;
    }
    if (action === "unmap-league") {
      saveMergeLeagueMapping("unmap", String(button.dataset.crownLeagueId || ""));
      return;
    }
    if (action === "edit") {
      state.merge.editingPinnacleIds.add(pinnacleId);
      renderMergeWorkspace();
      return;
    }
    if (action === "cancel-edit") {
      state.merge.editingPinnacleIds.delete(pinnacleId);
      state.merge.selectedCrownByPinnacle.delete(pinnacleId);
      renderMergeWorkspace();
      return;
    }
    if (action === "unmap") {
      saveMergeMapping("unmap", pinnacleId);
      return;
    }
    if (action === "choose") {
      const crownId = String(button.dataset.crownId || "");
      state.merge.selectedCrownByPinnacle.set(pinnacleId, crownId);
      renderMergeWorkspace();
      const picker = document.getElementById(`merge-crown-picker-${pinnacleId}`);
      const crown = mergeCrownById(state.merge.data).get(crownId);
      if (picker && crown) {
        picker.value = mergeCrownOptionValue(crown);
        picker.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (action === "choose-pinnacle") {
      const crownId = String(button.dataset.crownId || "");
      const pinnacleId = String(button.dataset.pinnacleId || "");
      state.merge.selectedPinnacleByCrown.set(crownId, pinnacleId);
      renderMergeWorkspace();
      const picker = document.getElementById(`merge-pinnacle-picker-${crownId}`);
      const pinnacle = new Map((state.merge.data?.pinnacleEvents || []).map((item) => [String(item.id), item])).get(pinnacleId);
      if (picker && pinnacle) {
        picker.value = mergePinnacleOptionValue(pinnacle);
        picker.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return;
    }
    if (action === "map") {
      const crownId = state.merge.selectedCrownByPinnacle.get(pinnacleId) || "";
      if (!crownId) {
        showToast("请先从候选列表中选择一场皇冠赛事");
        return;
      }
      const occupied = [...mergeMappedByPinnacle(state.merge.data).values()].some((mapping) =>
        String(mapping.crownId) === crownId && String(mapping.pinnacleId) !== pinnacleId,
      );
      if (occupied) {
        showToast("这场皇冠赛事已关联到另一场平博赛事，请刷新后重新选择");
        state.merge.selectedCrownByPinnacle.delete(pinnacleId);
        renderMergeWorkspace();
        return;
      }
      saveMergeMapping("map", pinnacleId, crownId);
      return;
    }
    if (action === "map-suggestion") {
      const crownId = String(button.dataset.crownId || "");
      if (!pinnacleId || !crownId) return;
      const occupied = [...mergeMappedByPinnacle(state.merge.data).values()].some((mapping) =>
        String(mapping.crownId) === crownId && String(mapping.pinnacleId) !== pinnacleId,
      );
      if (occupied) {
        showToast("这场皇冠赛事已关联到另一场平博赛事，请刷新后重新选择");
        return;
      }
      saveMergeMapping("map", pinnacleId, crownId);
      return;
    }
    if (action === "map-from-crown") {
      const crownId = String(button.dataset.crownId || "");
      const pinnacleId = state.merge.selectedPinnacleByCrown.get(crownId) || "";
      if (!pinnacleId) {
        showToast("请先从候选列表中选择一场平博赛事");
        return;
      }
      const existing = mergeMappedByPinnacle(state.merge.data).get(pinnacleId);
      if (existing && String(existing.crownId) !== crownId) {
        showToast("这场平博赛事已关联其他皇冠赛事，请先在平博视图解除原关联");
        return;
      }
      saveMergeMapping("map", pinnacleId, crownId);
    }
    if (action === "map-crown-suggestion") {
      const crownId = String(button.dataset.crownId || "");
      const targetPinnacleId = String(button.dataset.pinnacleId || "");
      if (!crownId || !targetPinnacleId) return;
      const existing = mergeMappedByPinnacle(state.merge.data).get(targetPinnacleId);
      if (existing && String(existing.crownId) !== crownId) {
        showToast("这场平博赛事已关联其他皇冠赛事，请先在平博视图解除原关联");
        return;
      }
      saveMergeMapping("map", targetPinnacleId, crownId);
      return;
    }
  });

}
