import type { PlatformHints } from "./types";

/**
 * SAP SuccessFactors (karriereportaler på successfactors.eu/.com). Vedleggsfeltene har ikke noe
 * filfelt før man klikker «+». Da åpnes en boks med «Last opp fra enhet» (et ekte filfelt),
 * og opplastingen starter så snart en fil er valgt.
 */
export const successfactors: PlatformHints = {
  name: "SuccessFactors",
  uploadWidget: {
    container: ".attachmentField",
    label: ".rcmFormFieldLabel",
    trigger: '[id$="_attachIcon"].addAttachments',
    // Navnet på den opplastede filen vises i stedet for «Last opp en CV».
    uploaded: '[id$="_attachDownloadLabel"]:not(.displayNone)',
  },
};
