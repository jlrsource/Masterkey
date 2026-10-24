import {
  bestDegreeOptionIndex,
  DEGREE_LEVEL_NAMES,
  degreeLevel,
  fieldOfStudySearchTerms,
  languageLevelOptionIndex,
  languageOptionIndex,
  overallLanguageLevel,
  type Certification,
  type Education,
  type Experience,
  type Reference,
  type FullProfile,
  type Language,
  type LanguageLevel,
  type Volunteering,
} from "@soknadsprofil/shared";
import type { FieldReport, FillPayload } from "../types";
import { HINT_ERRORS, hintedFieldKey } from "./platforms";
import { fillSearchInput, isSearchInput, pickFromListbox, pickFromMenu, realClick, type OptionMatcher } from "./picker";
import { commonAncestor, composedContains, composedParent, deepQueryAll, describeEl, documentHost, log, sleep, waitFor } from "./util";
import {
  bestOptionIndex,
  checkOption,
  scanChoiceGroups,
  selectDatePart,
  setDatePartSelect,
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

export type SectionKind = "experiences" | "educations" | "volunteering" | "languages" | "websites" | "references" | "certifications";

export const SECTION_LABELS: Record<SectionKind, string> = {
  experiences: "Arbeidserfaring",
  educations: "Utdanning",
  volunteering: "Verv",
  languages: "Språk",
  websites: "Nettsider",
  references: "Referanser",
  certifications: "Kurs og sertifikater",
};

const MAX_ENTRIES = 10;

// Rekkefølgen betyr noe: «Volunteer experience» skal bli verv, ikke arbeidserfaring.
const SECTION_PATTERNS: [SectionKind, RegExp][] = [
  // Andre personer først: disse skal aldri få brukerens egne opplysninger.
  ["references", /referanse|\breferences?\b|referees?|attestant/],
  ["volunteering", /volunt|frivillig|\bverv\b/],
  ["certifications", /\bkurs\b|\bcourses?\b|sertifikat|sertifisering|certific|licen[sc]e|lisens/],
  ["languages", /\blanguages?\b|\bspråk/],
  ["websites", /\bwebsites?\b|\bnettsider?\b|\bnettsteder\b|\blinks\b|\blenker\b|\blinker\b|online profiles?/],
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
  'input:not([type="hidden"]):not([type="file"]):not([type="radio"]), textarea, select, button[aria-haspopup="listbox"], [role="combobox"]:not(input), [role="menu"][aria-label]';

/** Nedtrekksliste bygget som meny (role="menu" med role="menuitem"), f.eks. Jobbnorges månedsvelger. */
function isMenuDropdown(el: Element): boolean {
  return el.getAttribute("role") === "menu" && el.querySelectorAll('[role="menuitem"]').length >= 2;
}

type BlockKey =
  | "title" | "employer" | "location" | "current" | "start" | "end" | "description"
  | "school" | "degree" | "field" | "grade"
  | "language" | "fluent" | "overall" | "spoken" | "written"
  | "url" | "urlType"
  | "credits"
  | "refName" | "refCompany" | "refRole" | "email" | "phone" | "relation"
  | "certName" | "issuer";

/** Felt som alltid er avkrysningsbokser (og bare de). */
const CHECKBOX_KEYS: BlockKey[] = ["current", "fluent"];

type FieldGroup = "work" | "education" | "language" | "website" | "reference" | "certification";

const GROUP_OF: Record<SectionKind, FieldGroup> = {
  experiences: "work",
  volunteering: "work",
  educations: "education",
  languages: "language",
  websites: "website",
  references: "reference",
  certifications: "certification",
};

const FIELD_PATTERNS: Record<FieldGroup, [BlockKey, RegExp][]> = {
  reference: [
    // Teksten er normalisert («E-post» → «e post»), så bindestrek kan være mellomrom.
    ["email", /\be ?post|\be ?mail|\bmail\b/],
    ["phone", /telefon|mobil|\bphone\b|\btlf\b/],
    ["relation", /relasjon|relation|forhold til|relationship/],
    ["refCompany", /firma|company|arbeidsgiver|employer|organisasjon|organi[sz]ation|bedrift/],
    ["refRole", /tittel|rolle|\btitle\b|\brole\b|stilling|position/],
    ["refName", /navn|\bname\b/],
  ],
  certification: [
    ["issuer", /utsteder|arrangør|issuer|institusjon|institution|tilbyder|provider|organisasjon|skole/],
    ["url", /url|lenke|link/],
    ["start", /dato|\bdate\b|fullført|completed|\bår\b|\byear\b|\bfra\b|\bfrom\b/],
    ["certName", /navn|\bname\b|kurs|sertifikat|tittel|\btitle\b|certific/],
  ],
  website: [
    ["urlType", /\btype\b|\bkind\b|\bslags\b/],
    ["description", /beskrivelse|description|hva handler|handler lenken|about|om lenken/],
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
    ["current", /currently|jobber her|nåværende|pågående|fortsatt|\bcurrent\b|present|\bstill\b/],
    ["description", /description|beskrivelse|arbeidsoppgaver|responsibilit|ansvar|oppgaver/],
    ["start", /\bfrom\b|\bfra\b|\bstart/],
    ["end", /\bto\b|\btil\b|\bend\b|slutt/],
    ["title", /job title|stillingstittel|tittel|\btitle\b|position|stilling|\brolle\b|\brole\b/],
    ["employer", /company|firma|arbeidsgiver|employer|bedrift|organi[sz]ation|organisasjon/],
    ["location", /location|arbeidssted|\bsted\b|\bcity\b|\bby\b/],
  ],
  education: [
    ["current", /fortsatt|under utdanning|currently|ongoing|pågående|studerer|in progress|still studying/],
    ["credits", /studiepoeng|vekttall|\bcredits?\b|\bects\b/],
    ["description", /description|beskrivelse/],
    ["start", /\bfrom\b|\bfra\b|\bstart|first year/],
    ["end", /\bto\b|\btil\b|\bend\b|slutt|last year|graduat|ferdig/],
    ["field", /field of study|fagfelt|studieretning|\bmajor\b|discipline|studium|studiet|studieprogram/],
    ["school", /school|university|universitet|skole|lærested|institution|institusjon|lærestad|college|høgskole|høgskule/],
    ["degree", /degree|\bgrad\b|utdanningsnivå|nivå/],
    ["grade", /gpa|\bgrade\b|karakter|snitt|overall result/],
  ],
};

// ---------------------------------------------------------------- hjelpere

/** Felt i et område, også inni web-komponenter (åpen shadow DOM, f.eks. Jobbnorges jn-input). */
function controlsIn(root: ParentNode): HTMLElement[] {
  return deepQueryAll<HTMLElement>(root, BLOCK_CONTROLS).filter(
    (el) =>
      (el.getAttribute("role") !== "menu" || isMenuDropdown(el)) &&
      isVisible(el) &&
      !(el as HTMLInputElement).disabled &&
      el.getAttribute("aria-hidden") !== "true",
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
  /** «Legg til»-knappen. Mangler når en redigeringsboks allerede er åpen (knappen er da skjult). */
  addButton: HTMLElement | null;
  container: Element;
  /** Seksjonens overskrift og neste seksjons overskrift: alt mellom dem hører til seksjonen. */
  heading?: HTMLElement;
  nextHeading?: HTMLElement | null;
}

const isAfter = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING);

/** Felt i seksjonen: mellom overskriften og neste overskrift på samme nivå (ellers containeren). */
function sectionControls(doc: Document, section: Section): HTMLElement[] {
  if (!section.heading) return controlsIn(section.container);
  // Felt inni web-komponenter sammenlignes via komponenten (verten) i dokumentet.
  return controlsIn(doc).filter((el) => {
    const host = documentHost(el);
    return isAfter(host, section.heading!) && (!section.nextHeading || isAfter(section.nextHeading, host));
  });
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
    // Lagrede oppføringer har ofte egne, lavere overskrifter («Norsk - bokmål» under «Språk»).
    // Gå bakover forbi dem til nærmeste overskrift som er en seksjon, men ikke forbi en på samme nivå.
    const level = (h: HTMLElement) => (/^H[1-6]$/.test(h.tagName) ? Number(h.tagName[1]) : 7);
    for (let j = idx; j >= 0; j--) {
      if (kindFromText(norm(preceding[j]!.textContent ?? ""))) {
        const between = preceding.slice(j + 1, idx + 1);
        if (between.every((h) => level(h) > level(preceding[j]!))) idx = j;
        break;
      }
    }
    const lastKind = idx >= 0 ? kindFromText(norm(preceding[idx]!.textContent ?? "")) : null;
    // «Add Work Experience» i aria-label sier det direkte. Ellers avgjør overskriften.
    const kind = kindFromText(norm(button.getAttribute("aria-label") ?? "")) ?? lastKind;
    if (!kind) continue; // f.eks. «Websites [Add]»
    while (idx > 0 && /\d+$/.test(norm(preceding[idx]!.textContent ?? "")) && kindFromText(norm(preceding[idx - 1]!.textContent ?? "")) === kind) idx--;
    const heading = idx >= 0 && lastKind === kind ? preceding[idx] : undefined;
    const container = heading ? commonAncestor([heading, button]) : button.parentElement;
    // Neste seksjon starter ved neste overskrift av samme type (h1 → h1), som ikke er en blokk-overskrift.
    const nextHeading = heading
      ? headings.find((h) => isAfter(h, button) && h.tagName === heading.tagName && !/\d+$/.test(norm(h.textContent ?? ""))) ?? null
      : null;
    if (container && !sections.some((s) => s.kind === kind)) sections.push({ kind, addButton: button, container, heading, nextHeading });
  }
  // Seksjoner uten synlig «Legg til» fordi en redigeringsboks (med «Lagre») allerede er åpen.
  for (const heading of headings.filter((h) => /^H[1-4]$/.test(h.tagName))) {
    const kind = kindFromText(norm(heading.textContent ?? ""));
    if (!kind || sections.some((s) => s.kind === kind) || /\d+$/.test(norm(heading.textContent ?? ""))) continue;
    const nextHeading = headings.find((h) => isAfter(h, heading) && h.tagName === heading.tagName) ?? null;
    const section: Section = { kind, addButton: null, container: heading.parentElement ?? heading, heading, nextHeading };
    const controls = sectionControls(doc, section);
    if (controls.length && editorRoot(controls)) sections.push(section);
  }
  return sections;
}

// ---------------------------------------------------------------- fylle én blokk

type DatePart = "month" | "year" | "day";

function datePart(el: HTMLElement): DatePart | null {
  // Nedtrekksliste: alternativene avslører delen (årstall, 1–12/månedsnavn, 1–31).
  if (el instanceof HTMLSelectElement) return selectDatePart(el);
  if (isMenuDropdown(el)) {
    const items = Array.from(el.querySelectorAll('[role="menuitem"]')).map((i) => norm(i.textContent ?? ""));
    return items.filter((t) => /^(jan|feb|mar|apr|mai|may|jun|jul|aug|sep|okt|oct|nov|des|dec)/.test(t)).length >= 10 ? "month" : null;
  }
  if (!(el instanceof HTMLInputElement) || !["text", "number", "tel", ""].includes(el.type)) return null;
  const own = describeField(el);
  const t = norm(`${el.getAttribute("aria-label") ?? ""} ${el.placeholder} ${el.getAttribute("data-automation-id") ?? ""} ${el.name} ${own.label ?? ""}`);
  // Ikke \b rundt norske ord: i JavaScript regnes ikke «å» som en bokstav, så \bår\b treffer aldri.
  const word = (w: string) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "u");
  if (word("month").test(t) || /måned/.test(t) || word("mm").test(t) || /datesectionmonth/.test(t)) return "month";
  if (word("year").test(t) || word("år").test(t) || word("yyyy").test(t) || /åååå|datesectionyear/.test(t)) return "year";
  if (word("day").test(t) || word("dag").test(t) || word("dd").test(t) || /datesectionday/.test(t)) return "day";
  return null;
}

/** Teksten som beskriver feltet. For dato-deler (måned/år) er det teksten til hele dato-gruppen («From»). */
function fieldText(el: HTMLElement, block: HTMLElement[]): string {
  if (datePart(el)) {
    // Klatre (også ut av web-komponenter) så lenge vi bare har dato-deler rundt oss.
    let node = composedParent(el);
    let text = "";
    for (let depth = 0; node && depth < 8; depth++) {
      const inside = block.filter((c) => composedContains(node!, c));
      if (inside.some((c) => !datePart(c))) break; // gått ut av dato-gruppen
      text = labelWithoutControls(node) || text;
      node = composedParent(node);
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
  const group = GROUP_OF[kind];
  for (const [key, re] of FIELD_PATTERNS[group]) {
    if (CHECKBOX_KEYS.includes(key) !== isCheckbox) continue;
    // Type-feltet er en nedtrekksliste, ikke et tekstfelt. URL står aldri i et stort tekstfelt.
    if (key === "urlType" && el instanceof HTMLInputElement) continue;
    if (key === "url" && el instanceof HTMLTextAreaElement) continue;
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

type Entry = Experience | Education | Volunteering | Language | WebsiteEntry | Reference | Certification;

/** Pågår utdanningen (ingen sluttdato, eller sluttdato frem i tid)? */
function stillStudying(e: Record<string, unknown>, today = new Date()): boolean {
  const end = typeof e.end_date === "string" ? new Date(e.end_date) : null;
  return !end || Number.isNaN(end.getTime()) || end > today;
}

/** Studiepoeng ut fra antall semestre (30 per semester) fra start til slutt, eller til i dag. */
function creditsFor(e: Record<string, unknown>, today = new Date()): string | null {
  if (typeof e.start_date !== "string") return null;
  const start = new Date(e.start_date);
  const end = stillStudying(e, today) ? today : new Date(e.end_date as string);
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (Number.isNaN(months) || months < 4) return null;
  return String(Math.round(months / 6) * 30);
}

/** Beskrivelse av lenken, slik feltene heter i profilen. */
const WEBSITE_DESCRIPTIONS: Record<WebsiteEntry["type"], string> = {
  linkedin: "LinkedIn",
  github: "GitHub",
  website: "Nettside/portefølje",
};

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
    case "current": return kind === "educations" ? stillStudying(e) : Boolean(e.is_current);
    case "start": return kind === "certifications" ? s("issued_date") : s("start_date");
    case "end": return e.is_current || (kind === "educations" && stillStudying(e)) ? null : s("end_date");
    case "credits": return creditsFor(e);
    case "refName": return s("name");
    case "refCompany": return s("company");
    case "refRole": return s("role");
    case "email": return s("email");
    case "phone": return s("phone");
    case "relation": return s("relation");
    case "certName": return s("name");
    case "issuer": return s("issuer");
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
    case "description":
      if (kind === "websites") return WEBSITE_DESCRIPTIONS[(e.type as WebsiteEntry["type"]) ?? "website"] ?? null;
      return s("description");
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

const SAVE_LABEL = /^(lagre|save|ok|ferdig|done|bekreft|confirm|legg til (oppføring|denne)|add entry)$/;
const FORBIDDEN_LABEL = /send|submit|neste|next|fortsett|continue|søk(nad)?\b|apply/;

/** Boksen rundt en blokk som har sin egen «Lagre»-knapp (redigeringsboks), eller null. */
function editorRoot(block: HTMLElement[]): Element | null {
  let node: Element | null = commonAncestor(block) ?? (block[0] ? composedParent(block[0]) : null);
  for (let depth = 0; node && depth < 8; depth++) {
    if (saveButtonIn(node)) return node;
    node = composedParent(node);
  }
  return null;
}

/** «Lagre»-knappen i en redigeringsboks. Aldri «Send»/«Neste»/«Søk»: de sender inn eller går videre. */
function saveButtonIn(root: Element): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"], input[type="button"]'));
  return (
    buttons.find((b) => {
      const t = norm(b.getAttribute("aria-label") || b.textContent || (b as HTMLInputElement).value || "");
      return SAVE_LABEL.test(t) && !FORBIDDEN_LABEL.test(t) && isVisible(b) && !(b as HTMLButtonElement).disabled;
    }) ?? null
  );
}

/**
 * Lagre blokken hvis den ligger i en redigeringsboks med egen «Lagre» (f.eks. Jobbnorge, der bare
 * én oppføring kan redigeres om gangen). Returnerer en feilmelding hvis lagringen ikke gikk.
 */
async function saveBlockIfNeeded(block: HTMLElement[]): Promise<string | null> {
  const root = editorRoot(block);
  const save = root && saveButtonIn(root);
  if (!save) return null;
  const doc = save.ownerDocument;
  const errorsBefore = new Set(visibleErrors(doc));
  const textBefore = new Set(textLines(root!));
  log(`lagrer blokken med ${describeEl(save)}`);
  // Påkrevde felt som fortsatt er tomme (en vanlig grunn til at «Lagre» ikke gjør noe).
  const emptyRequired = deepQueryAll<HTMLElement>(root!, '[required], [aria-required="true"]')
    .filter((el) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !el.value.trim())
    .map((el) => describeField(el as HTMLInputElement).label ?? (el as HTMLInputElement).name);
  if (emptyRequired.length) log("påkrevde felt som er tomme før «Lagre»:", emptyRequired);
  realClick(save);
  // Noen sider sjekker innholdet før de lagrer (f.eks. lenkeskanning hos Jobbnorge). Vent rolig.
  const closed = await waitFor(() => block.every((el) => !el.isConnected || !isVisible(el)), 12000);
  if (closed) {
    log("lagret ✓");
    return null;
  }
  const invalid = root ? invalidFields(root) : [];
  if (invalid.length) {
    log("lagring stoppet, ugyldige felt:", invalid);
    return `«Lagre» stoppet på: ${invalid.slice(0, 3).join(", ")}`;
  }
  // Ny tekst i boksen etter klikket er nesten alltid en valideringsmelding («Fra dato må være før til dato»).
  const newText = root ? textLines(root).filter((t) => !textBefore.has(t)) : [];
  if (newText.length) {
    log("lagring stoppet med melding:", newText);
    return `«Lagre» ga melding: «${newText[0]!.slice(0, 80)}»`;
  }
  const newErrors = visibleErrors(doc).filter((e) => !errorsBefore.has(e));
  log("lagring gikk ikke. Nye meldinger på siden:", newErrors);
  return newErrors.length ? `«Lagre» ga feil: «${newErrors[0]!.slice(0, 80)}»` : "blokken ble ikke lagret";
}

/** Radioknapp-grupper i blokken (f.eks. språknivå «Skriftlig»/«Muntlig»): velg alternativet som passer. */
function fillBlockRadios(block: HTMLElement[], entry: Entry, kind: SectionKind): number {
  const root = editorRoot(block) ?? commonAncestor(block);
  if (!root) return 0;
  let filled = 0;
  for (const group of scanChoiceGroups(root, { deep: true })) {
    if (group.options.some((o) => o.el.checked)) continue;
    const question = norm(group.question);
    const key = FIELD_PATTERNS[GROUP_OF[kind]].find(([k, re]) => !CHECKBOX_KEYS.includes(k) && re.test(question))?.[0];
    if (!key) continue;
    const value = entryValue(key, entry, kind);
    if (typeof value !== "string") continue;
    const texts = group.options.map((o) => o.text);
    const i = ["overall", "spoken", "written"].includes(key) ? languageLevelOptionIndex(texts, value as LanguageLevel) : bestOptionIndex(texts.map((text) => ({ text })), value, 2);
    const option = group.options[i];
    if (!option) continue;
    checkOption(option.el);
    highlight(option.el.labels?.[0] ?? option.el, "filled", `Masterkey: ${SECTION_LABELS[kind]}`);
    filled++;
  }
  return filled;
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
  if (el instanceof HTMLSelectElement && part && (key === "start" || key === "end")) return setDatePartSelect(el, part, value);
  if (isMenuDropdown(el)) {
    const match: OptionMatcher =
      part === "month" && (key === "start" || key === "end")
        ? (texts) => (Number(value.split("-")[1]) - 1 < texts.length ? Number(value.split("-")[1]) - 1 : -1)
        : (texts) => matchOption(texts, value, key, context);
    return pickFromMenu(el, match);
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
      const ok = await setControl(el, value, key, part, entryContext(entry), aiSearchTerms(entry));
      log(`  ${key}${part ? `/${part}` : ""} = «${String(value).slice(0, 40)}» ${ok ? "✓" : "✗ ble ikke satt"}`);
      if (ok) {
        usedKeys.add(slot);
        filled++;
        highlight(el, "filled", `Masterkey: ${SECTION_LABELS[kind]}`);
      }
    } catch (e) {
      console.warn("[Masterkey] kunne ikke fylle felt i blokk", key, e);
    }
  }
  return filled + fillBlockRadios(block, entry, kind);
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
  if (kind === "references") return [...(profile.references ?? [])] as Entry[];
  if (kind === "certifications") return [...(profile.certifications ?? [])] as Entry[];
  const list = (profile[kind] ?? []) as Entry[];
  return [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).slice(0, MAX_ENTRIES);
}

/** Tomme felt som ikke fantes før klikket. Felt med verdi er gamle blokker som ble tegnet på nytt. */
function newEmptyControls(doc: Document, before: Set<HTMLElement>): HTMLElement[] {
  return controlsIn(doc).filter((el) => !before.has(el) && isEmptyControl(el));
}

/** Er feltet urørt? Avkrysningsbokser: ikke krysset av. Nedtrekksknapper: viser fortsatt «Velg …». */
function isEmptyControl(el: HTMLElement): boolean {
  // Menyvelgere har alltid et standardvalg (f.eks. inneværende måned). De regnes som urørte.
  if (isMenuDropdown(el)) return true;
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return !el.checked;
  // En liste på første alternativ er urørt, selv om det ikke er en «Velg …»-plassholder (f.eks. «Januar»).
  if (el instanceof HTMLSelectElement) return el.selectedIndex <= 0 || !hasValue(el);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return !hasValue(el);
  const t = norm(el.textContent ?? "");
  return !t || /^(select|velg|choose|vel)\b/.test(t) || t === "select one";
}

/**
 * Klikker «Legg til»/«Add Another» og returnerer feltene i den nye blokken, eller null.
 * Prøver to ganger: noen skjemaer lagrer forrige blokk først og ignorerer det første klikket.
 */
/** Synlige feilmeldinger på siden, f.eks. «This field is required». */
function visibleErrors(doc: Document): string[] {
  return deepQueryAll<HTMLElement>(doc, ['[role="alert"]', ".error", ".errorMessage", ...HINT_ERRORS].join(", "))
    .filter(isVisible)
    .map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t && t.length < 200);
}

/** Synlige tekstlinjer i et område (uten innholdet i feltene), for å se hva som endret seg. */
function textLines(root: Element): string[] {
  return deepQueryAll<HTMLElement>(root, "li, p, span, div, small, label, strong")
    .filter((el) => isVisible(el) && !el.querySelector("input, select, textarea, li, p, div"))
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 3 && t.length < 160);
}

/** Felt i boksen som siden har markert som ugyldige (aria-invalid eller ugyldig ifølge nettleseren). */
function invalidFields(root: Element): string[] {
  return deepQueryAll<HTMLElement>(root, "input, select, textarea, [aria-invalid]")
    .filter((el) => el.getAttribute("aria-invalid") === "true" || (el as HTMLInputElement).validity?.valid === false)
    .map((el) => {
      const d = describeField(el as HTMLInputElement);
      return (d.label || d.ariaLabel || d.placeholder || d.name || "ukjent felt").replace(/\s*\*\s*$/, "").slice(0, 40);
    });
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
    // Etter «Lagre» kan det ta litt tid før «Legg til» er tilbake.
    const button = await waitFor(
      () => addButtonAfter(doc, previousBlock) ?? findSections(doc).find((s) => s.kind === kind)?.addButton ?? null,
      5000,
    );
    if (!button) return { block: null, reason };
    const before = new Set(controlsIn(doc));
    const errorsBefore = new Set(visibleErrors(doc));
    button.scrollIntoView?.({ block: "center" });
    log(`${SECTION_LABELS[kind]}: klikker ${describeEl(button)} «${norm(button.textContent ?? "")}»`);
    realClick(button);
    const appeared = await waitFor(() => {
      const fresh = newEmptyControls(doc, before);
      return fresh.length ? fresh : null;
    }, 4000);
    if (appeared) {
      await sleep(300); // la resten av blokken bli tegnet
      const fresh = newEmptyControls(doc, before);
      // Ta med alle nye felt i samme redigeringsboks, også forhåndsutfylte (f.eks. inneværende år).
      const root = editorRoot(fresh);
      const block = root ? controlsIn(doc).filter((el) => !before.has(el) && composedContains(root, el)) : fresh;
      log(`${SECTION_LABELS[kind]}: ny blokk med ${block.length} felt`);
      return { block, reason: "" };
    }
    log(`${SECTION_LABELS[kind]}: ingen nye tomme felt (${controlsIn(doc).filter((el) => !before.has(el)).length} nye felt totalt)`);
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

/** All tekst mellom to elementer i dokumentet (seksjonens innhold). */
function textBetween(start: Element, end: Element | null): string {
  const range = start.ownerDocument.createRange();
  range.setStartAfter(start);
  if (end) range.setEndBefore(end);
  else range.setEndAfter(start.ownerDocument.body.lastChild ?? start);
  return range.toString();
}

/** Står oppføringen allerede i seksjonen? Sjekker det som identifiserer den (språk, arbeidsgiver …). */
function entryAlreadyPresent(sectionText: string, entry: Entry, kind: SectionKind): boolean {
  const e = entry as Record<string, unknown>;
  const ids: Partial<Record<SectionKind, string[]>> = {
    languages: ["language"],
    experiences: ["employer", "title"],
    volunteering: ["organization", "role"],
    educations: ["school"],
    references: ["name"],
    certifications: ["name"],
    websites: ["url"],
  };
  const values = (ids[kind] ?? []).map((k) => (typeof e[k] === "string" ? norm(e[k] as string) : "")).filter((v) => v.length >= 3);
  // Nettadresser kan vises uten https://www.
  if (kind === "websites") return values.some((v) => sectionText.includes(v.replace(/^https? (www )?/, "")));
  return values.length > 0 && values.every((v) => sectionText.includes(v));
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

    const existing = sectionControls(doc, initial);
    existing.forEach((el) => handled.add(el));
    if (entries.length === 0) continue;
    if (!payload.overwrite && existing.some((el) => !isEmptyControl(el))) {
      report.status = "skipped-has-value";
      continue;
    }

    // Oppføringer som allerede er lagt inn (står som tekst i seksjonen), legges ikke inn på nytt.
    const sectionText = norm(initial.heading ? textBetween(initial.heading, initial.nextHeading ?? null) : initial.container.textContent ?? "");
    const already = entries.filter((e) => entryAlreadyPresent(sectionText, e, kind));
    if (already.length) {
      log(`${SECTION_LABELS[kind]}: ${already.length} finnes fra før, hopper over dem`);
      entries.splice(0, entries.length, ...entries.filter((e) => !already.includes(e)));
      if (!entries.length) {
        report.label = `${SECTION_LABELS[kind]} (alt finnes fra før)`;
        report.status = "skipped-has-value";
        continue;
      }
    }

    let done = 0;
    let stopReason = "";
    let previousBlock: HTMLElement[] = [];
    // Noen skjemaer viser en tom blokk fra start. Den fylles før vi klikker «Legg til».
    if (existing.length > 0 && (await fillBlock(existing, entries[0]!, kind)) > 0) {
      done = 1;
      previousBlock = existing;
      const saveError = await saveBlockIfNeeded(existing);
      if (saveError) stopReason = saveError;
    }

    for (let i = done; i < entries.length && !stopReason; i++) {
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
      // Redigeringsboks med egen «Lagre»: lagre før neste «Legg til» (ellers går det ikke).
      const saveError = await saveBlockIfNeeded(block);
      if (saveError) stopReason = saveError;
    }

    report.label = `${SECTION_LABELS[kind]} (${done} av ${entries.length}${stopReason ? `: ${stopReason}` : ""})`;
    report.status = done === entries.length ? "filled" : done > 0 ? "uncertain" : "failed";
  }
  // Seksjonene tegnes ofte på nytt (nye elementer). Den vanlige utfyllingen skal ikke røre noe
  // inni dem, ellers kan f.eks. «web address» i en URL-blokk få postadressen.
  for (const section of findSections(doc)) sectionControls(doc, section).forEach((el) => handled.add(el));
  return { handled, fields };
}
