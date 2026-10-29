import { dom } from "../dom.js";
import { renderEvents } from "./events.js";
import { renderOdds } from "./markets.js";
import { selectEvent } from "./snapshot.js";
import { setupSectionCollapse } from "../shared/dom.js";
import { SETTINGS_PREF_KEYS, writePreference } from "../shared/preferences.js";
import { state } from "../state.js";

export function bindPinnacleEvents() {
  setupSectionCollapse(
    dom.historyPanel,
    dom.historyToggle,
    dom.historyContent,
    "ps3838.dashboard.historyCollapsed",
  );
  setupSectionCollapse(
    dom.changesPanel,
    dom.changesToggle,
    dom.changesContent,
    "ps3838.dashboard.changesCollapsed",
  );

  dom.eventList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-event-id]");
    if (item) selectEvent(item.dataset.eventId);
  });

  dom.changeFeed.addEventListener("click", (event) => {
    const card = event.target.closest("[data-event-id]");
    if (card) selectEvent(card.dataset.eventId);
  });

  dom.eventSearch.addEventListener("input", () => {
    state.search = dom.eventSearch.value.trim().toLowerCase();
    renderEvents(true);
  });

  dom.metadataFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) return;
    state.filter = button.dataset.filter;
    writePreference(SETTINGS_PREF_KEYS.filter, state.filter);
    if (dom.settingsDefaultFilter) dom.settingsDefaultFilter.value = state.filter;
    for (const chip of dom.metadataFilters.querySelectorAll("[data-filter]")) {
      chip.classList.toggle("active", chip === button);
    }
    renderEvents(true);
  });

  dom.sortSelect.addEventListener("change", () => {
    state.sort = dom.sortSelect.value;
    writePreference(SETTINGS_PREF_KEYS.sort, state.sort);
    if (dom.settingsDefaultSort) dom.settingsDefaultSort.value = state.sort;
    renderEvents(true);
  });

  dom.marketTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-market]");
    if (!button) return;
    state.market = button.dataset.market;
    for (const tab of dom.marketTabs.querySelectorAll("[data-market]")) {
      const active = tab === button;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    renderOdds();
  });

}
