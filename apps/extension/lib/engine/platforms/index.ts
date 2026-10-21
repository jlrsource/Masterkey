import type { PlatformHints } from "./types";
import { workday } from "./workday";

export type { PlatformHints } from "./types";

/** Alle plattform-hint. Legg til nye plattformer her ved behov. */
export const PLATFORM_HINTS: PlatformHints[] = [workday];

const all = <K extends keyof PlatformHints>(key: K) => PLATFORM_HINTS.flatMap((h) => (h[key] ?? []) as unknown[]) as string[];

export const HINT_OPTIONS = all("options");
export const HINT_OPTION_ROWS = all("optionRows");
export const HINT_LIST_CONTAINERS = all("listContainers");
export const HINT_ERRORS = all("errors");
export const HINT_FIELD_CONTAINERS = PLATFORM_HINTS.map((h) => h.fieldContainer).filter((s): s is string => Boolean(s));
export const HINT_SEARCH_MARKERS = PLATFORM_HINTS.map((h) => h.searchInputMarkers).filter((s): s is string => Boolean(s));

/** Plattformens eget navn på feltet, oversatt til en felttype (f.eks. «title»), eller null. */
export function hintedFieldKey(el: Element): string | null {
  for (const h of PLATFORM_HINTS) {
    const name = h.fieldName?.(el);
    if (name && h.fieldNames?.[name]) return h.fieldNames[name]!;
  }
  return null;
}

/** Containeren rundt feltet, hvis en plattform definerer en. */
export function hintedFieldContainer(el: Element): Element | null {
  for (const sel of HINT_FIELD_CONTAINERS) {
    const c = el.closest(sel);
    if (c) return c;
  }
  return null;
}
