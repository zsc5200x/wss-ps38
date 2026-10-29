import { dom } from "./dom.js";
import { refreshMerge } from "./merge/page.js";
import { setStatus } from "./pinnacle/snapshot.js";
import { renderSettingsStatusFromSnapshot } from "./settings-status.js";
import { fetchSettings } from "./settings.js";
import { syncPreferenceControls } from "./shared/preferences.js";
import { resolvePage } from "./shared/routes.js";
import { state } from "./state.js";

export function isCrownView(page = state.currentPage) {
  return page === "home" || page === "crown";
}

export function activeCrownFrame() {
  return dom.crownFrames.find((frame) => {
    const panel = frame.closest("[data-page-panel]");
    return panel?.dataset.pagePanel === state.currentPage;
  }) || null;
}

export function ensureCrownFrameLoaded(frame = activeCrownFrame()) {
  if (!frame || frame.dataset.loaded === "true") return;
  const source = frame.dataset.src;
  if (!source) return;
  frame.dataset.loaded = "true";
  frame.src = source;
}

export function postCrownCommandTo(frame, command, payload = {}) {
  if (!frame?.contentWindow) return;
  frame.contentWindow.postMessage(
    { type: "crown:command", command, ...payload },
    location.origin,
  );
}

export function syncCrownFrameActivity() {
  const activeFrame = activeCrownFrame();
  for (const frame of dom.crownFrames) {
    if (frame.dataset.loaded !== "true") continue;
    postCrownCommandTo(frame, "set-paused", {
      paused: frame !== activeFrame,
    });
  }
}

export function showPage(page, updateLocation = true) {
  const target = resolvePage(page);
  const crownView = isCrownView(target);
  state.currentPage = target;
  document.body.classList.toggle("crown-mode", crownView);
  for (const button of dom.primaryNav.querySelectorAll("[data-page]")) {
    const active = button.dataset.page === target;
    button.classList.toggle("active", active);
    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }
  for (const panel of dom.pagePanels) {
    panel.classList.toggle("hidden", panel.dataset.pagePanel !== target);
  }
  if (crownView) {
    ensureCrownFrameLoaded();
  } else {
    setStatus(state.snapshot?.freshness || "no-data");
    if (target === "settings") {
      renderSettingsStatusFromSnapshot(state.snapshot);
      fetchSettings();
    }
  }
  syncPreferenceControls();
  if (target === "merge") refreshMerge();
  syncCrownFrameActivity();
  document.title = {
    home: "皇冠赛事",
    pinnacle: "平博数据",
    crown: "皇冠数据",
    "my-events": "我的赛事",
    merge: "赛事合并",
    settings: "系统设置",
  }[target];
  if (updateLocation) {
    const nextHash = target === "home" ? "" : `#${target}`;
    history.replaceState(null, "", `${location.pathname}${location.search}${nextHash}`);
  }
  window.scrollTo(0, 0);
}
