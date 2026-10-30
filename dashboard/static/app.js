import { POLL_INTERVAL } from "./modules/constants.js";
import { bindMergeEvents } from "./modules/merge/bindings.js";
import { refreshMerge } from "./modules/merge/page.js";
import { bindMetadataEvents } from "./modules/metadata-bindings.js";
import { fetchMetadataStatus } from "./modules/metadata.js";
import { bindMyEventsEvents } from "./modules/my-events/bindings.js";
import { pollMyEventsEvents } from "./modules/my-events/page.js";
import { bindPinnacleEvents } from "./modules/pinnacle/bindings.js";
import { refresh } from "./modules/pinnacle/snapshot.js";
import { bindRouterEvents } from "./modules/router-bindings.js";
import { showPage } from "./modules/router.js";
import { bindSettingsEvents } from "./modules/settings-bindings.js";
import { loadSettingsPreferences, syncPreferenceControls } from "./modules/shared/preferences.js";
import { resolvePage } from "./modules/shared/routes.js";
import { state } from "./modules/state.js";

bindPinnacleEvents();
bindSettingsEvents();
bindMergeEvents();
bindMyEventsEvents();
bindRouterEvents();
bindMetadataEvents();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refresh();
    fetchMetadataStatus();
  }
});

const preferredPage = loadSettingsPreferences();
const initialPage = location.hash.slice(1) ? resolvePage(location.hash.slice(1)) : preferredPage;
showPage(initialPage, false);
syncPreferenceControls();
refresh(true);
fetchMetadataStatus();
window.setInterval(() => {
  if (!document.hidden) {
    refresh();
    fetchMetadataStatus();
    if (state.currentPage === "merge") refreshMerge();
  }
}, POLL_INTERVAL);
window.setInterval(() => {
  if (!document.hidden && state.currentPage === "my-events") {
    pollMyEventsEvents();
  }
}, 1000);
