import { createEngine } from "@/lib/engine/engine";

/**
 * Injiseres i fanen med chrome.scripting når brukeren ber om utfylling.
 * Erstatter alltid motoren: sider som Workday laster aldri helt på nytt mellom stegene,
 * og da ville en gammel versjon av motoren ellers blitt liggende etter en oppdatering.
 */
export default defineUnlistedScript(() => {
  window.__soknadsprofil = createEngine(document);
});
