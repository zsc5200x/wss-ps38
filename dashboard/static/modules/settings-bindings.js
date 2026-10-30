import { dom } from "./dom.js";
import { clearHistoryChart, fetchHistory } from "./history.js";
import { fetchMetadataStatus } from "./metadata.js";
import { renderEvents } from "./pinnacle/events.js";
import { renderChanges } from "./pinnacle/markets.js";
import { refresh } from "./pinnacle/snapshot.js";
import { fetchSettings, runSettingsMaintenance, saveCrownExtraMarketsSetting, saveSettings, saveTelegramSettings, testTelegram, discoverTelegramChats } from "./settings.js";
import { SETTINGS_PREF_KEYS, writePreference } from "./shared/preferences.js";
import { state } from "./state.js";

export function bindSettingsEvents() {
  dom.settingsDefaultPage?.addEventListener("change", () => {
    writePreference(SETTINGS_PREF_KEYS.page, dom.settingsDefaultPage.value);
  });

  dom.settingsDefaultSort?.addEventListener("change", () => {
    state.sort = dom.settingsDefaultSort.value;
    writePreference(SETTINGS_PREF_KEYS.sort, state.sort);
    if (dom.sortSelect) dom.sortSelect.value = state.sort;
    renderEvents(true);
  });

  dom.settingsDefaultFilter?.addEventListener("change", () => {
    state.filter = dom.settingsDefaultFilter.value;
    writePreference(SETTINGS_PREF_KEYS.filter, state.filter);
    for (const chip of dom.metadataFilters?.querySelectorAll("[data-filter]") || []) {
      chip.classList.toggle("active", chip.dataset.filter === state.filter);
    }
    renderEvents(true);
  });

  dom.settingsDefaultHistory?.addEventListener("change", () => {
    state.historyHours = Number(dom.settingsDefaultHistory.value) || 24;
    writePreference(SETTINGS_PREF_KEYS.history, state.historyHours);
    if (dom.historyRangeSelect) dom.historyRangeSelect.value = String(state.historyHours);
    state.historyPoints = [];
    state.historySummary = null;
    state.historyLastFetch = 0;
    clearHistoryChart();
    fetchHistory(true);
  });

  dom.settingsChangeLimit?.addEventListener("change", () => {
    state.changeLimit = Number(dom.settingsChangeLimit.value) || 20;
    writePreference(SETTINGS_PREF_KEYS.changeLimit, state.changeLimit);
    state.changesSignature = "";
    renderChanges(true);
  });

  dom.settingsRefreshButton?.addEventListener("click", () => {
    fetchSettings(true);
    refresh(true);
    fetchMetadataStatus(true);
  });

  dom.settingsMetadataCheckButton?.addEventListener("click", () => {
    runSettingsMaintenance("metadata");
  });

  dom.settingsMetadataRepairButton?.addEventListener("click", () => {
    runSettingsMaintenance("repair");
  });

  dom.settingsBackupButton?.addEventListener("click", () => {
    runSettingsMaintenance("backup");
  });

  dom.settingsIntegrityButton?.addEventListener("click", () => {
    runSettingsMaintenance("integrity");
  });

  dom.settingsTelegramSave?.addEventListener("click", () => {
    saveTelegramSettings();
  });

  dom.settingsTelegramChats?.addEventListener("click", () => {
    discoverTelegramChats();
  });
  dom.settingsTelegramTest?.addEventListener("click", () => {
    testTelegram();
  });

  dom.settingsSaveButton?.addEventListener("click", () => {
    saveSettings();
  });

  dom.settingsCrownExtraMarkets?.addEventListener("change", () => {
    saveCrownExtraMarketsSetting();
  });

}
