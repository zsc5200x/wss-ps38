import { dom } from "./dom.js";
import { activeCrownFrame, postCrownCommandTo, showPage } from "./router.js";
import { resolvePage } from "./shared/routes.js";

export function bindRouterEvents() {
  dom.primaryNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (button) showPage(button.dataset.page);
  });

  window.addEventListener("hashchange", () => {
    showPage(resolvePage(location.hash.slice(1)), false);
  });

  for (const frame of dom.crownFrames) {
    frame.addEventListener("load", () => {
      postCrownCommandTo(frame, "set-paused", {
        paused: frame !== activeCrownFrame(),
      });
    });
  }

  window.addEventListener("message", (event) => {
    const activeFrame = activeCrownFrame();
    if (event.source === activeFrame?.contentWindow) {
      // Keep iframe messages scoped to the active Crown view. The parent no
      // longer exposes manual pause/refresh controls, so there is no UI state
      // to mirror here.
    }
  });

}
