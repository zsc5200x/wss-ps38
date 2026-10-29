import { dom } from "./dom.js";
import { startMetadataSync } from "./metadata.js";

export function bindMetadataEvents() {
  dom.metadataCheckButton.addEventListener("click", () => {
    startMetadataSync(false);
  });

  dom.metadataRepairButton.addEventListener("click", () => {
    startMetadataSync(true);
  });

}
