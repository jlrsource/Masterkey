import type { PlatformHints } from "./types";

/**
 * Webcruiter. Vedlegg: «Legg til vedlegg» åpner et panel med et filfelt (Kendo Upload) som laster
 * opp med en gang. Ferdige filer får klassen k-file-success. «Vedlegg i MasterCV» røres ikke.
 */
export const webcruiter: PlatformHints = {
  name: "Webcruiter",
  uploadPanel: {
    trigger: "#addAttachmentBtn",
    input: "#select-attachments",
    attached: "#attachment-list-view",
    uploaded: ".k-file-success",
  },
};
