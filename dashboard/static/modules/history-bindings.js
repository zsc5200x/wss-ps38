import { dom } from "./dom.js";
import { clearHistoryChart, fetchHistory } from "./history.js";
import { SETTINGS_PREF_KEYS, writePreference } from "./shared/preferences.js";
import { state } from "./state.js";

export function bindHistoryEvents() {
  dom.historyRowSelect.addEventListener("change", () => {
    state.historyRowKey = dom.historyRowSelect.value;
    state.historyPoints = [];
    state.historySummary = null;
    state.historyLastFetch = 0;
    clearHistoryChart();
    fetchHistory(true);
  });

  dom.historyRangeSelect.addEventListener("change", () => {
    state.historyHours = Number(dom.historyRangeSelect.value) || 24;
    writePreference(SETTINGS_PREF_KEYS.history, state.historyHours);
    if (dom.settingsDefaultHistory) dom.settingsDefaultHistory.value = String(state.historyHours);
    state.historyPoints = [];
    state.historySummary = null;
    state.historyLastFetch = 0;
    clearHistoryChart();
    fetchHistory(true);
  });

  dom.historyRefreshButton.addEventListener("click", () => {
    fetchHistory(true);
  });

}
