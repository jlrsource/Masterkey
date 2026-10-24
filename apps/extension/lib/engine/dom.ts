import type { FieldDescriptor } from "@soknadsprofil/shared";
import { deepQueryAll } from "./util";

export type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;

const SELECTOR =
  'input:not([type="radio"]):not([type="checkbox"]), textarea, select, [contenteditable="true"], [contenteditable=""], button[aria-haspopup="listbox"], [role="combobox"]:not(input)';
const CHOICE_SELECTOR = 'input[type="radio"], input[type="checkbox"]';
const MAX_TEXT = 160;
/** Alle typer skjemafelt, brukt for å avgjøre hvor ett felt sin «boks» slutter. */
const ALL_CONTROLS = 'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [contenteditable=""]';

/** Finn alle skjemafelt, også inne i åpne shadow roots. */
export function scanFields(root: Document | ShadowRoot = document): FillableElement[] {
  const out: FillableElement[] = [];
  const visit = (node: Document | ShadowRoot | Element) => {
    node.querySelectorAll<FillableElement>(SELECTOR).forEach((el) => {
      if (isCandidate(el)) out.push(el);
    });
    node.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) visit(el.shadowRoot);
    });
  };
  visit(root);
  return out;
}

function isCandidate(el: FillableElement): boolean {
  if ((el as HTMLInputElement).disabled || (el as HTMLInputElement).readOnly) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el instanceof HTMLInputElement && el.type === "file") return true; // filfelt er ofte skjult bak en egen knapp
  return isVisible(el);
}

export function isVisible(el: Element): boolean {
  // jsdom har ingen layout; der regner vi alt som synlig.
  if (typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")) return true;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  return el.getClientRects().length > 0;
}

const clip = (s: string | null | undefined) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > MAX_TEXT ? "" : t; // lange tekster er sjelden en label
};

function textOfIds(ids: string | null, doc: Document | ShadowRoot): string {
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => doc.getElementById?.(id)?.textContent ?? (doc as Document).querySelector?.(`#${CSS.escape(id)}`)?.textContent ?? "")
    .join(" ");
}

function labelText(el: FillableElement): string {
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) return clip(Array.from(labels).map((l) => labelWithoutControls(l)).join(" "));
  const wrapping = el.closest("label");
  if (wrapping) return clip(labelWithoutControls(wrapping));
  return "";
}

/** Labeltekst uten verdier fra kontroller inni (f.eks. <select> inne i <label>). */
export function labelWithoutControls(label: Element): string {
  const clone = label.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("input, select, textarea, option").forEach((n) => n.remove());
  return clone.textContent ?? "";
}

/**
 * Teksten i «raden» et element står i: den ytterste forelderen som ikke inneholder
 * andre elementer av samme slag (f.eks. et kort med «Vitnemål *» og en skjult filknapp).
 */
function containerText(el: Element, sameKind: string, maxDepth = 8): string {
  let best = "";
  let node = el.parentElement;
  for (let depth = 0; node && depth < maxDepth; depth++) {
    if (node.querySelectorAll(sameKind).length > 1 || node.tagName === "FORM" || node.tagName === "BODY") break;
    const t = labelWithoutControls(node).replace(/\s+/g, " ").trim();
    if (t.length > MAX_TEXT) break;
    if (t) best = t;
    node = node.parentElement;
  }
  return best;
}

/** Tekst like i nærheten: forrige søsken, eller forrige søsken til en forelder (maks fire nivåer opp). */
function nearbyText(el: Element): string {
  let node: Element | null = el;
  for (let depth = 0; node && depth < 6; depth++) {
    let sib = node.previousElementSibling;
    for (let i = 0; sib && i < 2; i++) {
      if (!sib.matches(SELECTOR) && !sib.querySelector(SELECTOR)) {
        const t = clip(sib.textContent);
        if (t) return t;
      }
      sib = sib.previousElementSibling;
    }
    const legend = node.parentElement?.closest("fieldset")?.querySelector("legend");
    if (legend && depth === 3) return clip(legend.textContent);
    node = node.parentElement;
  }
  return "";
}

export function describeField(el: FillableElement): FieldDescriptor {
  const root = el.getRootNode() as Document | ShadowRoot;
  const isDropdown = !(el instanceof HTMLInputElement) && (el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("role") === "combobox");
  const tag: FieldDescriptor["tag"] =
    el instanceof HTMLInputElement ? "input" : el instanceof HTMLTextAreaElement ? "textarea" : el instanceof HTMLSelectElement || isDropdown ? "select" : "contenteditable";
  const isFile = el instanceof HTMLInputElement && el.type === "file";
  const ownLabel = labelText(el);
  return {
    tag,
    type: el instanceof HTMLInputElement ? el.type : undefined,
    autocomplete: el.getAttribute("autocomplete") ?? undefined,
    name: el.getAttribute("name") ?? undefined,
    id: el.id || undefined,
    placeholder: el.getAttribute("placeholder") ?? el.getAttribute("data-placeholder") ?? undefined,
    // Uten egen label bruker vi teksten i «boksen» feltet står alene i (spørsmål + felt).
    // Filfelt er ofte skjult bak egne knapper, og da er raden det eneste som sier hva de er.
    label: ownLabel || containerText(el, isFile ? 'input[type="file"]' : ALL_CONTROLS) || undefined,
    ariaLabel: clip(el.getAttribute("aria-label") || textOfIds(el.getAttribute("aria-labelledby"), root)) || undefined,
    nearbyText: nearbyText(el) || undefined,
  };
}

export function hasValue(el: FillableElement): boolean {
  // Egendefinert nedtrekksliste: tom så lenge den viser «Select One»/«Velg …».
  if (!(el instanceof HTMLInputElement) && (el.getAttribute("aria-haspopup") === "listbox" || el.getAttribute("role") === "combobox")) {
    const t = (el.textContent ?? "").trim();
    return Boolean(t) && !/^(select|velg|choose|vel)\b/i.test(t);
  }
  if (el instanceof HTMLInputElement && el.type === "file") return (el.files?.length ?? 0) > 0;
  if (el instanceof HTMLSelectElement) return el.selectedIndex > 0 || (el.selectedIndex === 0 && el.value !== "" && !isPlaceholderOption(el.options[0]));
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim() !== "";
  return (el.textContent ?? "").trim() !== "";
}

/** «Velg …» på flere språk (norsk, dansk, svensk, engelsk, tysk, fransk, spansk, italiensk, nederlandsk). */
export const PLACEHOLDER_WORDS = /velg|vælg|välj|vel\b|choose|select|please|wähle|wählen|auswählen|choisi|sélection|selecciona|seleziona|kies|--/i;

function isPlaceholderOption(opt: HTMLOptionElement | undefined): boolean {
  if (!opt) return true;
  return opt.value === "" || PLACEHOLDER_WORDS.test(opt.text);
}

/**
 * Ligger feltet i en innloggingsboks? Det er tilfellet når den minste boksen rundt feltet som også
 * har et passordfelt, er liten (høyst fire felt, f.eks. e-post + passord). Går aldri utenfor sitt
 * eget <form>, så et søknadsskjema på samme side som en innlogging ikke blir hoppet over.
 */
export function inLoginForm(el: Element): boolean {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 8; depth++) {
    if (node.querySelector('input[type="password"]')) {
      const fields = node.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]), select, textarea');
      return fields.length <= 4;
    }
    if (node.tagName === "FORM") return false;
    node = node.parentElement;
  }
  return false;
}

type DatePart = "year" | "month" | "day";

const MONTH_NAMES = /^(jan|feb|mar|apr|mai|may|jun|jul|aug|sep|okt|oct|nov|des|dec)/i;

/** Hvilken del av en dato en nedtrekksliste er, ut fra alternativene (årstall, 1–12/månedsnavn, 1–31). */
export function selectDatePart(sel: HTMLSelectElement): DatePart | null {
  const opts = Array.from(sel.options).filter((o) => !isPlaceholderOption(o)).map((o) => o.text.trim());
  if (opts.length < 2) return null;
  const nums = opts.map((t) => Number(t)).filter((n) => Number.isInteger(n));
  if (nums.length >= opts.length * 0.8) {
    if (nums.every((n) => n >= 1900 && n <= 2100)) return "year";
    const max = Math.max(...nums);
    if (max <= 12 && opts.length <= 12) return "month";
    if (max <= 31 && opts.length >= 28) return "day";
  }
  if (opts.filter((t) => MONTH_NAMES.test(t)).length >= 10) return "month";
  return null;
}

/**
 * Datoer delt i flere nedtrekkslister (år/måned/dag). Finner listene i samme lille gruppe som
 * `el`, avgjør hvilken del hver er ut fra alternativene, og fyller alle. Returnerer antall fylt.
 */
/** Velg riktig alternativ i en liste som er én del av en dato (år, måned som tall/navn, dag). */
export function setDatePartSelect(sel: HTMLSelectElement, part: DatePart, iso: string): boolean {
  const [y, m, d] = iso.split("-");
  const want = part === "year" ? y : part === "month" ? m : d;
  if (!want) return false;
  const opts = Array.from(sel.options);
  const option =
    opts.find((o) => !isPlaceholderOption(o) && (Number(o.text.trim()) === Number(want) || Number(o.value) === Number(want))) ??
    (part === "month" ? opts.filter((o) => MONTH_NAMES.test(o.text.trim()))[Number(m) - 1] : undefined);
  if (!option) return false;
  simulateFocus(sel);
  sel.value = option.value;
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  simulateBlur(sel);
  return true;
}

export function fillDateSelects(el: HTMLSelectElement, iso: string): number {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return 0;
  let group: Element | null = el.parentElement;
  for (let depth = 0; group && depth < 4; depth++) {
    const selects = group.querySelectorAll("select");
    if (selects.length >= 2 || group.querySelectorAll("input:not([type=hidden]), textarea").length > 0) break;
    group = group.parentElement;
  }
  const selects = group ? Array.from(group.querySelectorAll("select")) : [el];
  if (selects.length > 4) return 0; // for stor gruppe, sannsynligvis ikke en dato
  let filled = 0;
  for (const sel of selects.length ? selects : [el]) {
    const part = selectDatePart(sel);
    if (!part) continue;
    const want = part === "year" ? y : part === "month" ? m : d;
    const opts = Array.from(sel.options);
    const monthIndex = Number(m) - 1;
    const option =
      opts.find((o) => Number(o.text.trim()) === Number(want) || Number(o.value) === Number(want)) ??
      (part === "month" ? opts.filter((o) => MONTH_NAMES.test(o.text.trim()))[monthIndex] : undefined);
    if (!option) continue;
    simulateFocus(sel);
    sel.value = option.value;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    simulateBlur(sel);
    filled++;
  }
  return filled;
}

/** Sett verdi slik at React/Angular/Vue registrerer endringen. */
/**
 * Fokus inn i feltet, som når brukeren klikker i det.
 * Mens popupen er åpen har ikke siden fokus, så el.focus() fyrer ingen hendelser. Skjemaer som
 * Workday merker da aldri feltet som «besøkt» og viser «required»-feil. Derfor sender vi dem selv.
 */
export function simulateFocus(el: HTMLElement) {
  el.focus?.({ preventScroll: true });
  el.dispatchEvent(new FocusEvent("focus", { composed: true }));
  el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
}

/** Fokus ut av feltet. Det er her mange skjemaer lagrer og validerer verdien. */
export function simulateBlur(el: HTMLElement) {
  el.dispatchEvent(new FocusEvent("blur", { composed: true }));
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  el.blur?.();
}

export function setTextValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  simulateFocus(el);
  // Native setter, så React sin verdisporing ser endringen.
  if (setter) setter.call(el, value);
  else el.value = value;
  // composed: ekte input-hendelser krysser shadow DOM. Ligger feltet inni en web-komponent
  // (f.eks. Jobbnorges jn-input), lytter appen på komponenten, ikke på selve feltet.
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  simulateBlur(el);
}

const ALIASES: Record<string, string[]> = {
  norge: ["norway", "no", "nor", "noreg"],
  // Grader: norsk profil, ofte engelske alternativer.
  videregående: ["high school", "upper secondary", "secondary school"],
  doktorgrad: ["phd", "ph d", "doctorate", "doctoral"],
  mastergrad: ["master"],
  bachelorgrad: ["bachelor"],
  årsstudium: ["one year", "certificate"],
  sverige: ["sweden", "se", "swe"],
  danmark: ["denmark", "dk", "dnk"],
};

/** Ord som starter mange navn og derfor ikke sier noe om likhet. */
const GENERIC_FIRST_WORDS = /^(universit|college|høgsk|school|skole|the$|institut|academ|akadem|norges$|det$|den$|national|international|centre|center|department|faculty)/;

export const norm = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Finn alternativet som passer best med verdien (eksakt > starter med > inneholder).
 * Returnerer -1 hvis ingen når `minScore`.
 */
export function bestOptionIndex(options: { text: string; value?: string }[], value: string, minScore = 1): number {
  const target = norm(value);
  const candidates = [target, ...(ALIASES[target] ?? []), ...(ALIASES[target.split(" ")[0] ?? ""] ?? [])];
  const score = (o: { text: string; value?: string }) => {
    const t = norm(o.text);
    const v = norm(o.value ?? "");
    for (const c of candidates) {
      if (t === c || v === c) return 3;
    }
    for (const c of candidates) {
      if (c.length >= 3 && t.length >= 3 && (t.startsWith(c) || c.startsWith(t))) return 2;
    }
    // Første ord: «Master i informatikk» passer med «Master's Degree». Men ikke vanlige ord som
    // «Universitetet i Oslo» mot «Université Catholique de Louvain».
    const [first] = target.split(" ");
    const [optFirst] = t.split(" ");
    if (
      first && optFirst && first.length >= 4 && optFirst.length >= 4 &&
      !GENERIC_FIRST_WORDS.test(first) && !GENERIC_FIRST_WORDS.test(optFirst) &&
      (first.startsWith(optFirst) || optFirst.startsWith(first))
    ) return 2;
    for (const c of candidates) {
      if (c.length >= 4 && t.includes(c)) return 1;
    }
    return 0;
  };
  let best = -1;
  let bestScore = 0;
  options.forEach((o, i) => {
    const sc = score(o);
    if (sc > bestScore) {
      best = i;
      bestScore = sc;
    }
  });
  return bestScore >= minScore ? best : -1;
}

/** Velg alternativet som passer best med verdien. Returnerer false hvis ingen passer. */
export function setSelectValue(el: HTMLSelectElement, value: string): boolean {
  const options = Array.from(el.options).filter((o) => !isPlaceholderOption(o));
  const i = bestOptionIndex(options.map((o) => ({ text: o.text, value: o.value })), value);
  const best = options[i];
  if (!best) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  simulateFocus(el);
  if (setter) setter.call(el, best.value);
  else el.value = best.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  simulateBlur(el);
  return true;
}

// ---------------------------------------------------------------- avkrysningsbokser og radioknapper

export interface ChoiceGroup {
  question: string;
  options: { el: HTMLInputElement; text: string }[];
}

function optionText(el: HTMLInputElement): string {
  const label = labelText(el);
  if (label) return label;
  const aria = el.getAttribute("aria-label");
  if (aria) return clip(aria);
  // Tekst rett etter boksen, f.eks. <input> <span>Master</span>
  return clip(el.nextElementSibling?.textContent ?? el.parentElement?.textContent ?? "");
}

/** Elementet som omslutter hele gruppen: det minste med alle alternativene i. */
function groupContainer(inputs: HTMLInputElement[]): Element | null {
  let node: Element | null = inputs[0]?.parentElement ?? null;
  while (node && !inputs.every((i) => node!.contains(i))) node = node.parentElement;
  return node;
}

function groupQuestion(container: Element, first: HTMLInputElement): string {
  // Tekst i gruppens egen boks som ikke hører til alternativene (f.eks. <p>Muntlig</p> foran valgene).
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("label, input, fieldset, legend").forEach((n) => n.remove());
  const own = clip(clone.textContent);
  if (own) return own;
  const fieldset = first.closest("fieldset");
  // Deler flere grupper samme fieldset («Skriftlig» og «Muntlig» under «Hvor godt behersker du
  // språket?»), er teksten rett over gruppen mer presis enn fellesoverskriften.
  const groupsInFieldset = fieldset
    ? new Set(Array.from(fieldset.querySelectorAll<HTMLInputElement>(CHOICE_SELECTOR)).map((i) => i.name || i.id)).size
    : 0;
  if (fieldset && groupsInFieldset > 1 && !container.contains(fieldset)) {
    const near = nearbyText(container);
    if (near) return near;
  }
  const legend = fieldset?.querySelector("legend");
  if (legend) return clip(legend.textContent);
  const labelled = first.closest("[role=radiogroup],[role=group]");
  if (labelled) {
    const t = labelled.getAttribute("aria-label") || textOfIds(labelled.getAttribute("aria-labelledby"), first.getRootNode() as Document);
    if (t) return clip(t);
  }
  // Spørsmålet står som regel rett før gruppen.
  return nearbyText(container);
}

/** Nærmeste forelder som inneholder minst to bokser, altså selve gruppen. */
function smallestSharedAncestor(el: HTMLInputElement): Element | null {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 8; depth++) {
    if (node.querySelectorAll(CHOICE_SELECTOR).length > 1) return node;
    node = node.parentElement;
  }
  return null;
}

/** Finn grupper av avkrysningsbokser/radioknapper med minst to alternativer. */
export function scanChoiceGroups(doc: Document | Element, opts: { deep?: boolean } = {}): ChoiceGroup[] {
  const inputs = (opts.deep ? deepQueryAll<HTMLInputElement>(doc, CHOICE_SELECTOR) : Array.from(doc.querySelectorAll<HTMLInputElement>(CHOICE_SELECTOR))).filter(
    (el) => !el.disabled,
  );

  // 1. Samme name = samme gruppe (vanlig for radioknapper).
  const byName = new Map<string, HTMLInputElement[]>();
  for (const el of inputs) {
    if (!el.name) continue;
    const k = `${el.type}:${el.name}`;
    byName.set(k, [...(byName.get(k) ?? []), el]);
  }
  const groups: HTMLInputElement[][] = [];
  const grouped = new Set<HTMLInputElement>();
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    groups.push(list);
    list.forEach((el) => grouped.add(el));
  }

  // 2. Resten (ofte avkrysningsbokser med hvert sitt name) grupperes på felles forelder.
  const byContainer = new Map<Element, HTMLInputElement[]>();
  for (const el of inputs) {
    if (grouped.has(el)) continue;
    const container = el.closest("fieldset,[role=radiogroup],[role=group]") ?? smallestSharedAncestor(el);
    if (!container) continue;
    byContainer.set(container, [...(byContainer.get(container) ?? []), el]);
  }
  for (const list of byContainer.values()) if (list.length >= 2) groups.push(list);

  const out: ChoiceGroup[] = [];
  for (const list of groups) {
    const container = groupContainer(list);
    if (!container) continue;
    out.push({ question: groupQuestion(container, list[0]!), options: list.map((el) => ({ el, text: optionText(el) })) });
  }
  return out;
}

/** Krysser av som en bruker ville gjort, så rammeverkene får med seg endringen. */
export function checkOption(el: HTMLInputElement) {
  simulateFocus(el);
  if (!el.checked) el.click();
  simulateBlur(el);
}

export function setContentEditable(el: HTMLElement, value: string) {
  simulateFocus(el);
  const selection = el.ownerDocument.getSelection();
  if (selection) {
    selection.selectAllChildren(el);
  }
  // execCommand er utdatert, men er fortsatt det som fungerer best med rik-tekst-editorer.
  const ok = typeof el.ownerDocument.execCommand === "function" && el.ownerDocument.execCommand("insertText", false, value);
  if (!ok) {
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  }
  simulateBlur(el);
}

export function setFileValue(el: HTMLInputElement, files: File | File[]): boolean {
  try {
    const dt = new DataTransfer();
    for (const file of Array.isArray(files) ? files : [files]) dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- markering

const MARK_ATTR = "data-soknadsprofil";
const COLORS = { filled: "#22c55e", uncertain: "#f59e0b" } as const;

export function highlight(el: Element, kind: keyof typeof COLORS, title: string) {
  const target = (el instanceof HTMLInputElement && el.type === "file" ? el.closest("label") ?? el.parentElement ?? el : el) as HTMLElement;
  if (!target.hasAttribute(MARK_ATTR)) {
    target.setAttribute(`${MARK_ATTR}-prev`, target.getAttribute("style") ?? "");
  }
  target.setAttribute(MARK_ATTR, kind);
  target.style.setProperty("outline", `2px solid ${COLORS[kind]}`, "important");
  target.style.setProperty("outline-offset", "1px", "important");
  target.style.setProperty("transition", "outline-color .3s", "important");
  target.title = title;
}

export function clearHighlights(root: Document | ShadowRoot = document) {
  root.querySelectorAll<HTMLElement>(`[${MARK_ATTR}]`).forEach((el) => {
    const prev = el.getAttribute(`${MARK_ATTR}-prev`);
    if (prev) el.setAttribute("style", prev);
    else el.removeAttribute("style");
    el.removeAttribute(MARK_ATTR);
    el.removeAttribute(`${MARK_ATTR}-prev`);
  });
}
