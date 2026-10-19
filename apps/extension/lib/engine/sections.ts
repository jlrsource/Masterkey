import {
  bestDegreeOptionIndex,
  DEGREE_LEVEL_NAMES,
  degreeLevel,
  fieldOfStudySearchTerms,
  languageLevelOptionIndex,
  languageOptionIndex,
  overallLanguageLevel,
  type Education,
  type Experience,
  type FullProfile,
  type Language,
  type LanguageLevel,
  type Volunteering,
} from "@soknadsprofil/shared";
import type { FieldReport, FillPayload } from "../types";
import {
  bestOptionIndex,
  describeField,
  hasValue,
  highlight,
  isVisible,
  labelWithoutControls,
  norm,
  setSelectValue,
  setTextValue,
  simulateBlur,
  simulateFocus,
} from "./dom";

/**
 * Gjentakende seksjoner: «Work Experience [Add]», «Utdanning [Legg til]».
 * Feltene finnes ikke før man klikker, så vi klikker én gang per oppføring i profilen,
 * venter på at den nye blokken dukker opp, og fyller den med akkurat den oppføringen.
 */

export type SectionKind = "experiences" | "educations" | "volunteering" | "languages" | "websites";

export const SECTION_LABELS: Record<SectionKind, string> = {
  experiences: "Arbeidserfaring",
  educations: "Utdanning",
  volunteering: "Verv",
  languages: "Språk",
  websites: "Nettsider",
};

const MAX_ENTRIES = 10;

// Rekkefølgen betyr noe: «Volunteer experience» skal bli verv, ikke arbeidserfaring.
const SECTION_PATTERNS: [SectionKind, RegExp][] = [
  ["volunteering", /volunt|frivillig|\bverv\b/],
  ["languages", /\blanguages?\b|\bspråk/],
  ["websites", /\bwebsites?\b|\bnettsider?\b|\bnettsteder\b|\blinks\b|\blenker\b|online profiles?/],
  ["educations", /education|utdanning|skolegang|academic|studier/],
  ["experiences", /work experience|employment|work history|arbeidserfaring|yrkeserfaring|arbeidsforhold|erfaring|experience/],
];

/** «Add», «Add Another», «Legg til ny», «Add Work Experience» – men ikke «Add attachment». */
function isAddLabel(text: string): boolean {
  const m = /^\+?\s*(add|legg til)(\s+(another|more|new|ny|nytt|en|et|flere))?(\s+(.*))?$/.exec(text);
  if (!m) return false;
  const rest = m[5] ?? "";
  return rest === "" || kindFromText(rest) !== null;
}

/** Alt som kan fylles ut i en blokk, inkludert egendefinerte nedtrekkslister. */
const BLOCK_CONTROLS =
  'input:not([type="hidden"]):not([type="file"]):not([type="radio"]), textarea, select, button[aria-haspopup="listbox"], [role="combobox"]:not(input)';

type BlockKey =
  | "title" | "employer" | "location" | "current" | "start" | "end" | "description"
  | "school" | "degree" | "field" | "grade"
  | "language" | "fluent" | "overall" | "spoken" | "written"
  | "url" | "urlType";

/** Felt som alltid er avkrysningsbokser (og bare de). */
const CHECKBOX_KEYS: BlockKey[] = ["current", "fluent"];

/** Workday pakker hvert felt i data-automation-id="formField-<navn>". De navnene er sikrere enn labels. */
const WORKDAY_FIELDS: Record<string, BlockKey> = {
  jobtitle: "title",
  company: "employer",
  companyname: "employer",
  location: "location",
  currentlyworkhere: "current",
  roledescription: "description",
  description: "description",
  startdate: "start",
  enddate: "end",
  school: "school",
  schoolname: "school",
  degree: "degree",
  fieldofstudy: "field",
  gradeaverage: "grade",
  gpa: "grade",
  overallresult: "grade",
  firstyearattended: "start",
  lastyearattended: "end",
  language: "language",
  nativelanguage: "fluent",
  url: "url",
  websiteurl: "url",
};

const FIELD_PATTERNS: Record<"work" | "education" | "language" | "website", [BlockKey, RegExp][]> = {
  website: [
    ["urlType", /\btype\b|\bkind\b|\bslags\b/],
    ["url", /url|website|nettside|link|lenke|adresse|address/],
  ],
  language: [
    ["fluent", /fluent|flytende|native|morsmål/],
    ["spoken", /speak|spoken|muntlig|\btale\b|comprehension/],
    ["written", /writ|skriftlig|\bread|\blese/],
    ["overall", /overall|level|proficiency|nivå|ferdighet|samlet/],
    ["language", /language|språk/],
  ],
  work: [
    ["current", /currently|jobber her|nåværende|pågående|\bcurrent\b|present/],
    ["description", /description|beskrivelse|arbeidsoppgaver|responsibilit|ansvar|oppgaver/],
    ["start", /\bfrom\b|\bfra\b|\bstart/],
    ["end", /\bto\b|\btil\b|\bend\b|slutt/],
    ["title", /job title|stillingstittel|tittel|\btitle\b|position|stilling|\brolle\b|\brole\b/],
    ["employer", /company|firma|arbeidsgiver|employer|bedrift|organi[sz]ation|organisasjon/],
    ["location", /location|arbeidssted|\bsted\b|\bcity\b|\bby\b/],
  ],
  education: [
    ["description", /description|beskrivelse/],
    ["start", /\bfrom\b|\bfra\b|\bstart|first year/],
    ["end", /\bto\b|\btil\b|\bend\b|slutt|last year|graduat|ferdig/],
    ["field", /field of study|fagfelt|studieretning|\bmajor\b|discipline|studium|studiet|studieprogram/],
    ["school", /school|university|universitet|skole|lærested|institution|college|høgskole|høgskule/],
    ["degree", /degree|\bgrad\b|utdanningsnivå|nivå/],
    ["grade", /gpa|\bgrade\b|karakter|snitt|overall result/],
  ],
};

// ---------------------------------------------------------------- hjelpere

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(check: () => T | null | undefined | false, timeoutMs: number): Promise<T | null> {
  const start = Date.now();
  for (;;) {
    const v = check();
    if (v) return v;
    if (Date.now() - start > timeoutMs) return null;
    await sleep(100);
  }
}

function controlsIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(BLOCK_CONTROLS)).filter(
    (el) => isVisible(el) && !(el as HTMLInputElement).disabled && el.getAttribute("aria-hidden") !== "true",
  );
}

function elementText(el: Element): string {
  return norm(`${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`);
}

function kindFromText(text: string): SectionKind | null {
  return SECTION_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null;
}

// ---------------------------------------------------------------- finne seksjoner

interface Section {
  kind: SectionKind;
  addButton: HTMLElement;
  container: Element;
}

function findAddButtons(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>('button, [role="button"], a')).filter((b) => {
    const t = norm(b.getAttribute("aria-label") || b.textContent || "");
    return t.length < 60 && isAddLabel(t) && isVisible(b) && !(b as HTMLButtonElement).disabled;
  });
}

/**
 * Finn seksjonen en «Add»-knapp hører til, ut fra overskriften like over knappen.
 * Blokk-overskrifter som «Work Experience 2» hoppes over bakover til seksjonens egen overskrift.
 */
export function findSections(doc: Document): Section[] {
  const headings = Array.from(doc.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6,legend,[role=heading]"));
  const sections: Section[] = [];
  for (const button of findAddButtons(doc)) {
    const preceding = headings.filter((h) => h.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
    let idx = preceding.length - 1;
    const lastKind = idx >= 0 ? kindFromText(norm(preceding[idx]!.textContent ?? "")) : null;
    // «Add Work Experience» i aria-label sier det direkte. Ellers avgjør overskriften.
    const kind = kindFromText(norm(button.getAttribute("aria-label") ?? "")) ?? lastKind;
    if (!kind) continue; // f.eks. «Websites [Add]»
    while (idx > 0 && /\d+$/.test(norm(preceding[idx]!.textContent ?? "")) && kindFromText(norm(preceding[idx - 1]!.textContent ?? "")) === kind) idx--;
    const heading = idx >= 0 && lastKind === kind ? preceding[idx] : undefined;
    const container = heading ? commonAncestor([heading, button]) : button.parentElement;
    if (container && !sections.some((s) => s.kind === kind)) sections.push({ kind, addButton: button, container });
  }
  return sections;
}

// ---------------------------------------------------------------- fylle én blokk

type DatePart = "month" | "year" | "day";

function datePart(el: HTMLElement): DatePart | null {
  if (!(el instanceof HTMLInputElement)) return null;
  const t = norm(`${el.getAttribute("aria-label") ?? ""} ${el.placeholder} ${el.getAttribute("data-automation-id") ?? ""} ${el.name}`);
  if (/\bmonth\b|måned|\bmm\b|datesectionmonth/.test(t)) return "month";
  if (/\byear\b|\bår\b|\byyyy\b|åååå|datesectionyear/.test(t)) return "year";
  if (/\bday\b|\bdag\b|\bdd\b|datesectionday/.test(t)) return "day";
  return null;
}

/** Teksten som beskriver feltet. For dato-deler (måned/år) er det teksten til hele dato-gruppen («From»). */
function fieldText(el: HTMLElement, block: HTMLElement[]): string {
  if (datePart(el)) {
    let node = el.parentElement;
    let text = "";
    for (let depth = 0; node && depth < 6; depth++) {
      const inside = block.filter((c) => node!.contains(c));
      if (inside.some((c) => !datePart(c))) break; // gått ut av dato-gruppen
      text = labelWithoutControls(node);
      node = node.parentElement;
    }
    return norm(text);
  }
  const d = describeField(el as HTMLInputElement);
  return norm([d.label, d.ariaLabel, d.placeholder, d.name, d.id, d.nearbyText].filter(Boolean).join(" "));
}

function blockKey(el: HTMLElement, kind: SectionKind, block: HTMLElement[]): BlockKey | null {
  const wd = el.closest('[data-automation-id^="formField-"]')?.getAttribute("data-automation-id");
  if (wd) {
    const k = WORKDAY_FIELDS[wd.slice("formField-".length).toLowerCase()];
    if (k) return k;
  }
  const text = fieldText(el, block);
  if (!text) return null;
  const isCheckbox = el instanceof HTMLInputElement && el.type === "checkbox";
  const group = kind === "educations" ? "education" : kind === "languages" ? "language" : kind === "websites" ? "website" : "work";
  for (const [key, re] of FIELD_PATTERNS[group]) {
    if (CHECKBOX_KEYS.includes(key) !== isCheckbox) continue;
    // Type-feltet er en nedtrekksliste, ikke et tekstfelt.
    if (key === "urlType" && el instanceof HTMLInputElement) continue;
    if (re.test(text)) return key;
  }
  return null;
}

/** En lenke fra personalia (LinkedIn, GitHub, nettside) som skal inn i «Websites». */
interface WebsiteEntry {
  url: string;
  type: "linkedin" | "github" | "website";
  sort_order: number;
}

type Entry = Experience | Education | Volunteering | Language | WebsiteEntry;

const WEBSITE_TYPE_WORDS: Record<WebsiteEntry["type"], string[]> = {
  linkedin: ["linkedin"],
  github: ["github"],
  website: ["personal website", "personal", "portfolio", "website", "blog", "other"],
};

function entryValue(key: BlockKey, entry: Entry, kind: SectionKind): string | boolean | null {
  const e = entry as Record<string, unknown>;
  const s = (k: string) => (typeof e[k] === "string" && (e[k] as string).trim() ? (e[k] as string) : null);
  switch (key) {
    case "title": return kind === "volunteering" ? s("role") : s("title");
    case "employer": return kind === "volunteering" ? s("organization") : s("employer");
    case "location": return s("location");
    case "current": return Boolean(e.is_current);
    case "start": return s("start_date");
    case "end": return e.is_current ? null : s("end_date");
    case "description": return s("description");
    case "school": return s("school");
    // Uten grad i profilen: let etter nivået i fagfelt/beskrivelse («Bachelor i økonomi»).
    case "degree": {
      const fromText = degreeLevel([s("field_of_study"), s("description")].filter(Boolean).join(" "));
      return s("degree") ?? (fromText ? DEGREE_LEVEL_NAMES[fromText] : null);
    }
    case "field": return s("field_of_study");
    case "grade": return s("grade");
    case "language": return s("language");
    case "fluent": {
      const lvl = overallLanguageLevel(entry as Language);
      return lvl === "fluent" || lvl === "native";
    }
    case "overall": return overallLanguageLevel(entry as Language);
    case "url": return s("url");
    case "urlType": return s("type");
    case "spoken": return s("spoken_level") ?? overallLanguageLevel(entry as Language);
    case "written": return s("written_level") ?? overallLanguageLevel(entry as Language);
  }
}

/** ISO-dato til det formatet feltet ser ut til å forvente. */
function formatDate(iso: string, el: HTMLElement, part: DatePart | null): string {
  const [y = "", m = "", d = ""] = iso.split("-");
  if (part === "month") return m;
  if (part === "year") return y;
  if (part === "day") return d;
  if (el instanceof HTMLInputElement && el.type === "date") return iso;
  if (el instanceof HTMLInputElement && el.type === "month") return `${y}-${m}`;
  const ph = norm((el as HTMLInputElement).placeholder ?? "");
  const sep = ((el as HTMLInputElement).placeholder ?? "").includes(".") ? "." : "/";
  if (/\bdd\b/.test(ph)) return `${d}${sep}${m}${sep}${y}`;
  if (/yyyy mm|åååå mm/.test(ph)) return `${y}-${m}`;
  return `${m}${sep}${y}`;
}

/** Logg i sidens konsoll (DevTools), så vi kan se hva som skjer på ekte sider. */
const log = (...args: unknown[]) => console.info("[Masterkey]", ...args);

const describeEl = (el: Element) =>
  `<${el.tagName.toLowerCase()}${el.id ? `#${el.id.slice(0, 30)}` : ""}${el.getAttribute("data-automation-id") ? ` [${el.getAttribute("data-automation-id")}]` : ""}${el.getAttribute("role") ? ` role=${el.getAttribute("role")}` : ""}>`;

/** Musen «svever» over elementet: mange lister markerer raden før de godtar klikket. */
function hover(el: HTMLElement) {
  const r = el.getBoundingClientRect?.();
  const mouse: MouseEventInit = { bubbles: true, cancelable: true, composed: true, clientX: r ? r.left + r.width / 2 : 0, clientY: r ? r.top + r.height / 2 : 0 };
  const Pointer = (el.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.PointerEvent;
  for (const type of ["pointerover", "pointerenter", "pointermove"]) {
    if (Pointer) el.dispatchEvent(new Pointer(type, { ...mouse, pointerId: 1, pointerType: "mouse", isPrimary: true, bubbles: type !== "pointerenter" }));
  }
  el.dispatchEvent(new MouseEvent("mouseover", mouse));
  el.dispatchEvent(new MouseEvent("mouseenter", { ...mouse, bubbles: false }));
  el.dispatchEvent(new MouseEvent("mousemove", mouse));
}

/** Klikk som en ekte bruker: mange rammeverk (bl.a. Workday) reagerer på mousedown, ikke på click. */
function realClick(el: HTMLElement) {
  // Midt på elementet, som et ekte musetrykk (noen lister sjekker at trykket er innenfor raden).
  const r = el.getBoundingClientRect?.();
  const clientX = r ? r.left + r.width / 2 : 0;
  const clientY = r ? r.top + r.height / 2 : 0;
  const mouse: MouseEventInit = { bubbles: true, cancelable: true, composed: true, clientX, clientY, button: 0, detail: 1 };
  const Pointer = (el.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.PointerEvent;
  const pointer = (type: string, buttons: number) =>
    Pointer && el.dispatchEvent(new Pointer(type, { ...mouse, buttons, pointerId: 1, pointerType: "mouse", isPrimary: true }));

  hover(el);
  pointer("pointerdown", 1);
  const allowed = el.dispatchEvent(new MouseEvent("mousedown", { ...mouse, buttons: 1 }));
  // Som nettleseren: flytt fokus bare hvis siden ikke stoppet det. Lister stopper ofte mousedown
  // for å beholde fokus i søkefeltet; flytter vi fokus likevel, lukker de seg uten å velge.
  if (allowed) el.focus?.({ preventScroll: true });
  pointer("pointerup", 0);
  el.dispatchEvent(new MouseEvent("mouseup", mouse));
  el.dispatchEvent(new MouseEvent("click", mouse));
}

const PLACEHOLDER_OPTION = /^(select|velg|choose|vel)\b|^-+$|^no items|^no results|^ingen (treff|resultater)/;

/** Alternativer i åpne lister. Workday bruker også data-automation-id="promptOption" i søkefelt. */
const OPTION_SELECTOR = '[role="option"], [data-automation-id="promptOption"]';

function visibleOptions(doc: Document): HTMLElement[] {
  const all = Array.from(doc.querySelectorAll<HTMLElement>(OPTION_SELECTOR)).filter(
    (o) => isVisible(o) && !PLACEHOLDER_OPTION.test(norm(o.textContent ?? "")),
  );
  // Samme alternativ kan treffe begge selektorene (rad + innhold): behold det ytterste.
  return all.filter((o) => !all.some((other) => other !== o && other.contains(o)));
}

/** Hele raden et alternativ står i (Workday: radioknapp og tekst er søsken i samme rad). */
function optionRow(option: HTMLElement): HTMLElement {
  return (
    option.closest<HTMLElement>('[role="option"], [data-automation-id="promptLeafNode"], [data-automation-id="menuItem"]') ??
    (option.matches('[data-automation-id="promptOption"]') ? option.parentElement : null) ??
    option
  );
}

/** Teksten til et alternativ. Workday legger den nøyaktige teksten i data-automation-label. */
function optionLabel(option: HTMLElement): string {
  const labelled = option.matches("[data-automation-label]") ? option : option.querySelector("[data-automation-label]");
  return (labelled?.getAttribute("data-automation-label") ?? option.textContent ?? "").trim();
}

/**
 * Elementer å klikke, i rekkefølge. Klikk bobler oppover, ikke sidelengs, så sitter håndteringen
 * på radioknappen ved siden av teksten (Workday), må vi klikke radioknappen.
 */
function clickTargets(option: HTMLElement): HTMLElement[] {
  const row = optionRow(option);
  const control = row.querySelector<HTMLElement>('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]');
  const text = row.querySelector<HTMLElement>('[data-automation-id="promptOption"]');
  let deepest: HTMLElement = row;
  const wanted = norm(optionLabel(option));
  for (;;) {
    const child = Array.from(deepest.children).find((c) => norm(c.textContent ?? "") === wanted) as HTMLElement | undefined;
    if (!child) break;
    deepest = child;
  }
  return [...new Set([control, row, text, deepest, option].filter((x): x is HTMLElement => Boolean(x)))];
}

/** Feltets tekst uten selve listen og treffene (listen kan ligge inni feltet). */
function fieldTextWithoutList(field: Element): string {
  const clone = field.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll(`${OPTION_SELECTOR}, [role="listbox"], [data-automation-id="promptLeafNode"], [data-automation-id="activeListContainer"], input, textarea, select`)
    .forEach((n) => n.remove());
  return norm(clone.textContent ?? "");
}

/** Workday-felt (formField-…) viser alltid valget i feltet, så der kan vi sjekke strengt. */
const isStrictField = (field: Element | null) => Boolean(field?.matches?.('[data-automation-id^="formField-"]'));

/** Står det valgte alternativet nå i feltet (som en «pille» e.l.), eller i knappen? */
function selectionShows(field: Element | null, optionText: string): boolean {
  return Boolean(field && fieldTextWithoutList(field).includes(norm(optionText)));
}

/**
 * Velg et alternativ og sjekk at det satt. Prøver klikk på riktig element først, så tastatur
 * (pil ned til alternativet + Enter) via `keyTarget` hvis klikket ikke ble registrert.
 */
async function chooseOption(option: HTMLElement, index: number, field: Element | null, keyTarget: HTMLElement): Promise<boolean> {
  const text = optionLabel(option);
  const before = field ? fieldTextWithoutList(field).includes(norm(text)) : false;
  const strict = isStrictField(field);
  // Workday tegner listen på nytt når musen er over den, så «raden forsvant» betyr ikke at den
  // ble valgt. Der krever vi at valget står i feltet. Andre steder holder det at listen lukket seg.
  const done = () => (!before && selectionShows(field, text)) || (!strict && (!option.isConnected || !isVisible(option)));
  const doc = option.ownerDocument;
  const pressKey = (k: string) => {
    const target = (doc.activeElement as HTMLElement | null) ?? keyTarget;
    key(target, "keydown", k);
    key(target, "keyup", k);
  };

  // Raden kan bli tegnet på nytt (nye elementer) når musen kommer over den: finn den igjen på teksten.
  const again = () => visibleOptions(doc).find((o) => norm(optionLabel(o)) === norm(text)) ?? option;
  option.scrollIntoView?.({ block: "nearest" });
  hover(optionRow(option));
  await sleep(80);
  // Prøv radioknapp/avkrysning, så raden, så teksten. Stopp så snart valget sitter.
  const targets = clickTargets(again());
  log(`velger «${text}» (nr. ${index + 1}). Klikkmål:`, targets.map(describeEl).join(", "));
  for (let attempt = 0; attempt < 4; attempt++) {
    const target = clickTargets(again())[attempt];
    if (!target) break;
    realClick(target);
    if (await waitFor(done, 900)) {
      log(`valgt med klikk på ${describeEl(target)}`);
      return true;
    }
  }
  log("klikk ble ikke registrert, prøver tastatur");

  // Tastatur: pil ned til raden i et menneskelig tempo (for raske trykk blir slått sammen),
  // sjekk at riktig rad er markert, og velg med Enter (eller mellomrom for avkrysningsrader).
  simulateFocus(keyTarget);
  const highlighted = () => {
    const rows = visibleOptions(doc);
    return rows.find((o) => o.getAttribute("aria-selected") === "true" || o.matches(":focus, :focus-within") || o.getAttribute("data-focused") === "true");
  };
  const isTarget = (o: HTMLElement | undefined) => Boolean(o && norm(optionLabel(o)) === norm(text));
  for (let n = 0; n <= index + 2 && !isTarget(highlighted()); n++) {
    pressKey("ArrowDown");
    await sleep(140);
    // Vet vi hvilken rad som er markert, stopper vi så snart det er riktig rad.
    if (n >= index && !highlighted()) break;
  }
  for (const k of ["Enter", " "]) {
    pressKey(k);
    if (await waitFor(done, 1000)) {
      log(`valgt med tastatur (${k === " " ? "mellomrom" : k})`);
      return true;
    }
  }
  log("fikk ikke valgt", `«${text}»`, "– markert rad:", highlighted() ? optionLabel(highlighted()!) : "ingen");
  return false;
}

/** Indeksen til alternativet som passer best. Grad sammenlignes på nivå, resten på tekst. */
function matchOption(texts: string[], value: string, key: BlockKey, context: string): number {
  if (key === "urlType") {
    // Første ord i listen som finnes i et alternativ vinner («personal website» før «other»).
    for (const word of WEBSITE_TYPE_WORDS[value as WebsiteEntry["type"]] ?? []) {
      const i = texts.findIndex((t) => t.toLowerCase().includes(word));
      if (i >= 0) return i;
    }
    return -1;
  }
  if (key === "language") return languageOptionIndex(texts, value);
  if (key === "overall" || key === "spoken" || key === "written") return languageLevelOptionIndex(texts, value as LanguageLevel);
  if (key === "degree") {
    const i = bestDegreeOptionIndex(texts, value, context);
    if (i >= 0) return i;
  }
  return bestOptionIndex(texts.map((text) => ({ text })), value, 2);
}

/** Alternativene i listen som hører til akkurat denne knappen (aria-controls), ellers alle synlige. */
function optionsFor(trigger: HTMLElement): HTMLElement[] {
  const doc = trigger.ownerDocument;
  const id = trigger.getAttribute("aria-controls") || trigger.getAttribute("aria-owns");
  const own = id ? doc.getElementById(id) : null;
  const opts = own ? Array.from(own.querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible) : visibleOptions(doc);
  return opts.filter((o) => !PLACEHOLDER_OPTION.test(norm(o.textContent ?? "")));
}

/** Nærmeste element som faktisk scroller (lange lister viser ofte bare de øverste alternativene). */
function scrollContainer(el: Element | null): HTMLElement | null {
  for (let node = el as HTMLElement | null; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 4) return node;
  }
  return null;
}

async function closeListbox(trigger: HTMLElement) {
  for (const target of [trigger, trigger.ownerDocument.activeElement as HTMLElement | null]) {
    target?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }
  await waitFor(() => visibleOptions(trigger.ownerDocument).length === 0, 800);
}

const PLACEHOLDER_TRIGGER = /^(select|velg|choose|vel)\b/;

/** Egendefinert nedtrekksliste: åpne, vent på alternativene, velg det som passer best. */
async function pickFromListbox(trigger: HTMLElement, value: string, key: BlockKey, openFirst: boolean, context = ""): Promise<boolean> {
  const doc = trigger.ownerDocument;
  const texts = (opts: HTMLElement[]) => opts.map((o) => (o.textContent ?? "").trim());

  // Forrige liste må være lukket først, ellers leter vi i feil liste.
  await waitFor(() => visibleOptions(doc).length === 0, 1000);
  const stale = new Set(visibleOptions(doc));
  const fresh = () => optionsFor(trigger).filter((o) => !stale.has(o));

  let options: HTMLElement[] | null = null;
  // Prøv mus først, så tastatur (Enter/pil ned) hvis listen ikke åpnet seg.
  for (const open of openFirst ? ["mouse", "keyboard"] : ["none"]) {
    if (open === "mouse") realClick(trigger);
    if (open === "keyboard") {
      trigger.focus?.();
      for (const k of ["Enter", "ArrowDown"]) trigger.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    }
    options = await waitFor(() => {
      const opts = fresh();
      return opts.length ? opts : null;
    }, 2500);
    if (options) break;
  }
  if (!options) return false;

  let i = matchOption(texts(options), value, key, context);
  // Lange lister (f.eks. alle verdens språk) tegner bare det som er synlig: scroll til vi finner det.
  const scroller = scrollContainer(options[0]!.closest('[role="listbox"]') ?? options[0]!);
  for (let step = 0; i < 0 && scroller && step < 80; step++) {
    const before = scroller.scrollTop;
    scroller.scrollTop += Math.max(scroller.clientHeight * 0.8, 40);
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(120);
    options = fresh();
    i = matchOption(texts(options), value, key, context);
    if (scroller.scrollTop === before) break; // nådd bunnen
  }
  if (i < 0) {
    await closeListbox(trigger);
    return false;
  }

  const option = options[i]!;
  const field = trigger.closest('[data-automation-id^="formField-"]') ?? trigger;
  const chosen = await chooseOption(option, i, field, trigger);
  simulateBlur(trigger); // som når brukeren går videre til neste felt
  if (!chosen) return false;
  // Står knappen fortsatt på «Select One», ble valget ikke registrert.
  if (!(trigger instanceof HTMLInputElement) && PLACEHOLDER_TRIGGER.test(norm(trigger.textContent ?? ""))) return false;
  return true;
}

/** Søkefelt der man må velge fra en liste (Workday «prompt», autocomplete). Fritekst blir tømt ved blur. */
function isSearchInput(el: HTMLInputElement): boolean {
  if (el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete")) return true;
  if (el.getAttribute("data-uxi-widget-type") === "selectinput") return true;
  const field = el.closest('[data-automation-id^="formField-"]') ?? el.parentElement?.parentElement;
  return Boolean(field?.querySelector('[data-automation-id*="prompt" i], [data-automation-id*="multiSelect" i]'));
}

function key(el: HTMLElement, type: "keydown" | "keyup" | "keypress", k: string) {
  const e = new KeyboardEvent(type, { key: k, code: k, bubbles: true, cancelable: true });
  // Eldre kode sjekker keyCode/which (13 = Enter, 27 = Escape).
  const code = k === "Enter" ? 13 : k === "Escape" ? 27 : 0;
  Object.defineProperty(e, "keyCode", { get: () => code });
  Object.defineProperty(e, "which", { get: () => code });
  el.dispatchEvent(e);
}

/**
 * Søkefelt: skriv inn søkeordet, trykk Enter, og velg det beste treffet. Prøver søkeordene i
 * rekkefølge (f.eks. «Computer Science» før «Informatikk»). Uten treff tømmes feltet igjen.
 */
async function fillSearchInput(el: HTMLInputElement, terms: string[], key_: BlockKey): Promise<boolean> {
  const doc = el.ownerDocument;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const type = (v: string) => {
    if (setter) setter.call(el, v);
    else el.value = v;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: v }));
  };
  await waitFor(() => visibleOptions(doc).length === 0, 800);
  log("søkefelt", describeEl(el), "søkeord:", terms);
  for (const term of terms) {
    const stale = new Set(visibleOptions(doc));
    simulateFocus(el);
    type(term);
    for (const t of ["keydown", "keypress", "keyup"] as const) key(el, t, "Enter");
    const options = await waitFor(() => {
      const fresh = visibleOptions(doc).filter((o) => !stale.has(o));
      return fresh.length ? fresh : null;
    }, 3000);
    log(`søk «${term}»:`, options ? `${options.length} treff` : "ingen treff funnet");
    if (options) {
      const texts = options.map((o) => ({ text: optionLabel(o) }));
      // Fagfelt: godta også delvise treff («Computer Science and Engineering»).
      let i = bestOptionIndex(texts, term, 2);
      if (i < 0 && key_ === "field") i = bestOptionIndex(texts, term, 1);
      if (i >= 0) {
        const field = el.closest('[data-automation-id^="formField-"]') ?? el.parentElement;
        if (await chooseOption(options[i]!, i, field, el)) {
          simulateBlur(el);
          return true;
        }
      }
    }
    // Ingen treff (eller valget ble ikke registrert): tøm feltet og lukk listen før neste søkeord.
    type("");
    key(el, "keydown", "Escape");
    key(el, "keyup", "Escape");
    await waitFor(() => visibleOptions(doc).length === 0, 800);
  }
  simulateBlur(el);
  return false;
}

/** Fagfelt, skole og beskrivelse: avgjør f.eks. «Master of Science» vs. «Master of Arts». */
function entryContext(entry: Entry): string {
  const e = entry as Record<string, unknown>;
  return ["field_of_study", "school", "description"].map((k) => (typeof e[k] === "string" ? e[k] : "")).join(" ");
}

/** Engelske søkeord laget av AI i web-appen (tomt hvis ikke laget ennå). */
function aiSearchTerms(entry: Entry): string[] {
  const terms = (entry as Education).field_of_study_en;
  return Array.isArray(terms) ? terms.filter((t) => typeof t === "string" && t.trim()) : [];
}

async function setControl(
  el: HTMLElement,
  value: string | boolean,
  key: BlockKey,
  part: DatePart | null,
  context: string,
  aiTerms: string[] = [],
): Promise<boolean> {
  if (typeof value === "boolean") {
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      simulateFocus(el);
      if (el.checked !== value) el.click();
      simulateBlur(el);
      return true;
    }
    return false;
  }
  const text = key === "start" || key === "end" ? formatDate(value, el, part) : value;
  if (el instanceof HTMLSelectElement) {
    if (["degree", "language", "overall", "spoken", "written", "urlType"].includes(key)) {
      const opts = Array.from(el.options);
      const i = matchOption(opts.map((o) => o.text), text, key, context);
      if (i >= 0) {
        simulateFocus(el);
        el.value = opts[i]!.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        simulateBlur(el);
        return true;
      }
      if (key !== "degree") return false;
    }
    return setSelectValue(el, text);
  }
  if (el instanceof HTMLInputElement && isSearchInput(el)) {
    // Fagfelt: AI-søkeordene først, så den innebygde oversettelseslisten som reserve.
    const terms = key === "field" ? [...new Set([...aiTerms, ...fieldOfStudySearchTerms(text)])] : [text];
    return fillSearchInput(el, terms, key);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setTextValue(el, text);
    return true;
  }
  return pickFromListbox(el, text, key, true, context); // knapp med aria-haspopup="listbox"
}

async function fillBlock(block: HTMLElement[], entry: Entry, kind: SectionKind): Promise<number> {
  let filled = 0;
  const assigned = block.map((el) => ({ el, key: blockKey(el, kind, block), part: datePart(el) }));
  // Avkrysningsboksen «jobber her nå» først: den skjuler ofte sluttdato-feltene.
  assigned.sort((a, b) => Number(b.key === "current") - Number(a.key === "current"));
  const usedKeys = new Set<string>();
  for (const { el, key, part } of assigned) {
    if (!key || !el.isConnected) continue;
    const slot = `${key}:${part ?? ""}`;
    if (usedKeys.has(slot)) continue;
    const value = entryValue(key, entry, kind);
    if (value === null || value === false) continue;
    try {
      if (await setControl(el, value, key, part, entryContext(entry), aiSearchTerms(entry))) {
        usedKeys.add(slot);
        filled++;
        highlight(el, "filled", `Masterkey: ${SECTION_LABELS[kind]}`);
      }
    } catch (e) {
      console.warn("[Masterkey] kunne ikke fylle felt i blokk", key, e);
    }
  }
  return filled;
}

// ---------------------------------------------------------------- hovedløkken

/** Lenkene fra personalia, med https:// foran der det mangler. */
function websiteEntries(profile: FullProfile): WebsiteEntry[] {
  const p = profile.personal;
  const withScheme = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u.replace(/^\/+/, "")}`);
  const links: [WebsiteEntry["type"], string | null | undefined][] = [
    ["linkedin", p?.linkedin_url],
    ["github", p?.github_url],
    ["website", p?.website_url],
  ];
  return links
    .filter((l): l is [WebsiteEntry["type"], string] => Boolean(l[1]?.trim()))
    .map(([type, url], i) => ({ type, url: withScheme(url.trim()), sort_order: i }));
}

function entriesFor(kind: SectionKind, profile: FullProfile): Entry[] {
  if (kind === "websites") return websiteEntries(profile);
  const list = (profile[kind] ?? []) as Entry[];
  return [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).slice(0, MAX_ENTRIES);
}

/** Tomme felt som ikke fantes før klikket. Felt med verdi er gamle blokker som ble tegnet på nytt. */
function newEmptyControls(doc: Document, before: Set<HTMLElement>): HTMLElement[] {
  return controlsIn(doc).filter((el) => !before.has(el) && isEmptyControl(el));
}

/** Er feltet urørt? Avkrysningsbokser: ikke krysset av. Nedtrekksknapper: viser fortsatt «Velg …». */
function isEmptyControl(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return !el.checked;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return !hasValue(el);
  const t = norm(el.textContent ?? "");
  return !t || /^(select|velg|choose|vel)\b/.test(t) || t === "select one";
}

/**
 * Klikker «Legg til»/«Add Another» og returnerer feltene i den nye blokken, eller null.
 * Prøver to ganger: noen skjemaer lagrer forrige blokk først og ignorerer det første klikket.
 */
/** Synlige feilmeldinger på siden, f.eks. «This field is required». */
function visibleErrors(doc: Document): string[] {
  return Array.from(
    doc.querySelectorAll<HTMLElement>('[data-automation-id="errorMessage"], [data-automation-id="errorBanner"], [role="alert"], .error, .errorMessage'),
  )
    .filter(isVisible)
    .map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * «Add Another» står rett under forrige blokk. Den første «Legg til»-knappen etter blokkens
 * siste felt er derfor den riktige, uansett hvordan overskriftene er bygget opp.
 */
function addButtonAfter(doc: Document, previousBlock: HTMLElement[]): HTMLElement | null {
  const fields = previousBlock.filter((el) => el.isConnected);
  const anchor = fields.at(-1);
  if (!anchor) return null;
  // Knapper inni selve blokken («Add attachment» o.l.) er ikke «Add Another».
  const blockRoot = fields.length > 1 ? commonAncestor(fields) : null;
  return (
    findAddButtons(doc).find(
      (b) => anchor.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING && !(blockRoot && blockRoot.contains(b)),
    ) ?? null
  );
}

function commonAncestor(els: Element[]): Element | null {
  let node: Element | null = els[0]?.parentElement ?? null;
  while (node && !els.every((e) => node!.contains(e))) node = node.parentElement;
  return node;
}

async function addBlock(
  doc: Document,
  kind: SectionKind,
  previousBlock: HTMLElement[],
): Promise<{ block: HTMLElement[] | null; reason: string }> {
  let reason = "fant ikke «Legg til»-knappen";
  for (let attempt = 0; attempt < 2; attempt++) {
    // La skjemaet lagre forrige blokk før vi klikker (blur utløser ofte validering/lagring).
    (doc.activeElement as HTMLElement | null)?.blur?.();
    await sleep(attempt === 0 ? 400 : 1200);
    // Siden tegnes ofte på nytt etter hvert klikk, så knappen må finnes på nytt hver gang.
    const button = addButtonAfter(doc, previousBlock) ?? findSections(doc).find((s) => s.kind === kind)?.addButton;
    if (!button) return { block: null, reason };
    const before = new Set(controlsIn(doc));
    const errorsBefore = new Set(visibleErrors(doc));
    button.scrollIntoView?.({ block: "center" });
    button.click();
    const appeared = await waitFor(() => {
      const fresh = newEmptyControls(doc, before);
      return fresh.length ? fresh : null;
    }, 4000);
    if (appeared) {
      await sleep(300); // la resten av blokken bli tegnet
      return { block: newEmptyControls(doc, before), reason: "" };
    }
    // Forklar hva som skjedde, så vi vet hva som må fikses.
    const newErrors = visibleErrors(doc).filter((e) => !errorsBefore.has(e));
    const changed = controlsIn(doc).filter((el) => !before.has(el)).length;
    const label = norm(button.getAttribute("aria-label") || button.textContent || "");
    reason = newErrors.length
      ? `siden viste feil: «${newErrors[0]!.slice(0, 80)}»`
      : changed
        ? `klikket på «${label}» ga ${changed} felt, men ingen tomme`
        : `klikket på «${label}» ga ingen nye felt`;
  }
  return { block: null, reason };
}

export interface SectionResult {
  /** Felt som tilhører seksjonene. Den vanlige utfyllingen skal ikke røre dem. */
  handled: Set<Element>;
  fields: FieldReport[];
}

export async function fillRepeatingSections(payload: FillPayload, doc: Document): Promise<SectionResult> {
  const handled = new Set<Element>();
  const fields: FieldReport[] = [];

  for (const initial of findSections(doc)) {
    const { kind } = initial;
    const entries = entriesFor(kind, payload.profile);
    const report: FieldReport = { key: kind, label: SECTION_LABELS[kind], confidence: 1, status: "no-value" };
    fields.push(report);

    const existing = controlsIn(initial.container);
    existing.forEach((el) => handled.add(el));
    if (entries.length === 0) continue;
    if (!payload.overwrite && existing.some((el) => !isEmptyControl(el))) {
      report.status = "skipped-has-value";
      continue;
    }

    let done = 0;
    let stopReason = "";
    let previousBlock: HTMLElement[] = [];
    // Noen skjemaer viser en tom blokk fra start. Den fylles før vi klikker «Legg til».
    if (existing.length > 0 && (await fillBlock(existing, entries[0]!, kind)) > 0) {
      done = 1;
      previousBlock = existing;
    }

    for (let i = done; i < entries.length; i++) {
      const { block, reason } = await addBlock(doc, kind, previousBlock);
      if (!block) {
        stopReason = reason;
        break;
      }
      block.forEach((el) => handled.add(el));
      if ((await fillBlock(block, entries[i]!, kind)) === 0) {
        stopReason = "kjente ikke igjen feltene i blokken";
        break;
      }
      previousBlock = block;
      done++;
    }

    report.label = `${SECTION_LABELS[kind]} (${done} av ${entries.length}${stopReason ? `: ${stopReason}` : ""})`;
    report.status = done === entries.length ? "filled" : done > 0 ? "uncertain" : "failed";
  }
  // Seksjonene tegnes ofte på nytt (nye elementer). Den vanlige utfyllingen skal ikke røre noe
  // inni dem, ellers kan f.eks. «web address» i en URL-blokk få postadressen.
  for (const section of findSections(doc)) controlsIn(section.container).forEach((el) => handled.add(el));
  return { handled, fields };
}
