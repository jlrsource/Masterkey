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
import { HINT_ERRORS, hintedFieldKey } from "./platforms";
import { fillSearchInput, isSearchInput, pickFromListbox, realClick } from "./picker";
import { commonAncestor, sleep, waitFor } from "./util";
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
  // Plattformens egne feltnavn (f.eks. Workdays formField-jobTitle) er sikrere enn labels.
  const hinted = hintedFieldKey(el) as BlockKey | null;
  if (hinted) return hinted;
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
    return fillSearchInput(el, terms, { loose: key === "field" });
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setTextValue(el, text);
    return true;
  }
  return pickFromListbox(el, (texts) => matchOption(texts, text, key, context)); // knapp med aria-haspopup="listbox"
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
    doc.querySelectorAll<HTMLElement>(['[role="alert"]', ".error", ".errorMessage", ...HINT_ERRORS].join(", ")),
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
