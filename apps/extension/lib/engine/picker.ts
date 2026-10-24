/**
 * Lister og søkefelt: åpne en liste, finne riktig alternativ, og velge det slik at siden faktisk
 * registrerer valget. Bygger på web-standarden (role="option", "listbox", "combobox") og bruker
 * plattform-hint (platforms/) bare som tillegg.
 */
import { bestOptionIndex } from "./dom";
import { isVisible, labelWithoutControls, norm, simulateBlur, simulateFocus } from "./dom";
import { HINT_LIST_CONTAINERS, HINT_OPTION_ROWS, HINT_OPTIONS, HINT_SEARCH_MARKERS, hintedFieldContainer } from "./platforms";
import { describeEl, log, sleep, waitFor } from "./util";

/** Velger indeksen til riktig alternativ ut fra teksten i alternativene, eller -1. */
export type OptionMatcher = (texts: string[]) => number;

// ---------------------------------------------------------------- mus og tastatur

/** Musen «svever» over elementet: mange lister markerer raden før de godtar klikket. */
export function hover(el: HTMLElement) {
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

/** Klikk som en ekte bruker: mange rammeverk reagerer på mousedown/pointerdown, ikke bare click. */
export function realClick(el: HTMLElement) {
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

export function key(el: HTMLElement, type: "keydown" | "keyup" | "keypress", k: string) {
  const e = new KeyboardEvent(type, { key: k, code: k, bubbles: true, cancelable: true, composed: true });
  // Eldre kode sjekker keyCode/which (13 = Enter, 27 = Escape).
  const code = k === "Enter" ? 13 : k === "Escape" ? 27 : 0;
  Object.defineProperty(e, "keyCode", { get: () => code });
  Object.defineProperty(e, "which", { get: () => code });
  el.dispatchEvent(e);
}

// ---------------------------------------------------------------- alternativer

const PLACEHOLDER_OPTION = /^(select|velg|choose|vel)\b|^-+$|^no items|^no results|^no options|^ingen (treff|resultater)|^loading|^laster/;

const OPTION_SELECTOR = ['[role="option"]', ...HINT_OPTIONS].join(", ");
const ROW_SELECTOR = ['[role="option"]', ...HINT_OPTION_ROWS].join(", ");

/** Synlige alternativer i åpne lister. */
export function visibleOptions(doc: Document): HTMLElement[] {
  const all = Array.from(doc.querySelectorAll<HTMLElement>(OPTION_SELECTOR)).filter(
    (o) => isVisible(o) && !PLACEHOLDER_OPTION.test(norm(o.textContent ?? "")) && o.getAttribute("aria-disabled") !== "true",
  );
  // Samme alternativ kan treffe flere selektorer (rad + innhold): behold det ytterste.
  return all.filter((o) => !all.some((other) => other !== o && other.contains(o)));
}

/** Hele raden et alternativ står i (radioknapp og tekst kan være søsken i samme rad). */
function optionRow(option: HTMLElement): HTMLElement {
  const row = option.closest<HTMLElement>(ROW_SELECTOR);
  if (row) return row;
  return HINT_OPTIONS.some((s) => option.matches(s)) ? option.parentElement ?? option : option;
}

/** Teksten til et alternativ. Noen plattformer legger den nøyaktige teksten i et data-attributt. */
export function optionLabel(option: HTMLElement): string {
  const labelled = option.matches("[data-automation-label]") ? option : option.querySelector("[data-automation-label]");
  return (labelled?.getAttribute("data-automation-label") ?? option.textContent ?? "").trim();
}

/**
 * Elementer å klikke, i rekkefølge. Klikk bobler oppover, ikke sidelengs, så sitter håndteringen
 * på en radioknapp ved siden av teksten, må vi klikke radioknappen.
 */
function clickTargets(option: HTMLElement): HTMLElement[] {
  const row = optionRow(option);
  const control = row.querySelector<HTMLElement>('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]');
  const hinted = HINT_OPTIONS.length ? row.querySelector<HTMLElement>(HINT_OPTIONS.join(", ")) : null;
  let deepest: HTMLElement = row;
  const wanted = norm(optionLabel(option));
  for (;;) {
    const child = Array.from(deepest.children).find((c) => norm(c.textContent ?? "") === wanted) as HTMLElement | undefined;
    if (!child) break;
    deepest = child;
  }
  return [...new Set([control, row, hinted, deepest, option].filter((x): x is HTMLElement => Boolean(x)))];
}

// ---------------------------------------------------------------- sjekke at valget satt

/** Feltets tekst uten selve listen og treffene (listen kan ligge inni feltet). */
function fieldTextWithoutList(field: Element): string {
  const clone = field.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll([OPTION_SELECTOR, '[role="listbox"]', ...HINT_LIST_CONTAINERS, "input", "textarea", "select"].join(", "))
    .forEach((n) => n.remove());
  return norm(clone.textContent ?? "");
}

/** Står det valgte alternativet nå i feltet (som en «pille», i knappen e.l.)? */
function selectionShows(field: Element | null, optionText: string): boolean {
  return Boolean(field && fieldTextWithoutList(field).includes(norm(optionText)));
}

/** Containeren rundt et felt: plattformens egen (strengt), ellers et par nivåer opp. */
function fieldOf(el: HTMLElement): { field: Element | null; strict: boolean } {
  const hinted = hintedFieldContainer(el);
  if (hinted) return { field: hinted, strict: true };
  return { field: el.parentElement?.parentElement ?? el.parentElement, strict: false };
}

/**
 * Velg et alternativ og sjekk at det satt. Prøver klikk på riktige elementer først, så tastatur
 * (pil ned til alternativet + Enter) via `keyTarget` hvis klikket ikke ble registrert.
 */
async function chooseOption(option: HTMLElement, index: number, keyTarget: HTMLElement): Promise<boolean> {
  const text = optionLabel(option);
  const { field, strict } = fieldOf(keyTarget);
  const before = field ? fieldTextWithoutList(field).includes(norm(text)) : false;
  const inputBefore = keyTarget instanceof HTMLInputElement ? keyTarget.value : null;
  // Lister som tegnes på nytt når musen er over dem, gjør at «raden forsvant» ikke betyr at den ble
  // valgt. Med en plattform-container krever vi at valget står i feltet. Ellers holder det at
  // listen lukket seg, at valget vises i feltet, eller at søkefeltet nå viser det valgte.
  const done = () =>
    (!before && selectionShows(field, text)) ||
    (keyTarget instanceof HTMLInputElement && keyTarget.value !== inputBefore && norm(keyTarget.value) === norm(text)) ||
    (!strict && (!option.isConnected || !isVisible(option)));
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
  log(`velger «${text}» (nr. ${index + 1}). Klikkmål:`, clickTargets(again()).map(describeEl).join(", "));
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
  const highlighted = () =>
    visibleOptions(doc).find((o) => o.getAttribute("aria-selected") === "true" || o.matches(":focus, :focus-within") || o.getAttribute("data-focused") === "true");
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

// ---------------------------------------------------------------- nedtrekkslister

/** Alternativene i listen som hører til akkurat denne knappen (aria-controls), ellers alle synlige. */
function optionsFor(trigger: HTMLElement): HTMLElement[] {
  const doc = trigger.ownerDocument;
  const id = trigger.getAttribute("aria-controls") || trigger.getAttribute("aria-owns");
  const own = id ? doc.getElementById(id) : null;
  const opts = own ? Array.from(own.querySelectorAll<HTMLElement>(OPTION_SELECTOR)).filter(isVisible) : visibleOptions(doc);
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

/** Egendefinert nedtrekksliste: åpne, vent på alternativene, velg det `match` peker ut. */
export async function pickFromListbox(trigger: HTMLElement, match: OptionMatcher): Promise<boolean> {
  const doc = trigger.ownerDocument;
  const texts = (opts: HTMLElement[]) => opts.map(optionLabel);

  // Forrige liste må være lukket først, ellers leter vi i feil liste.
  await waitFor(() => visibleOptions(doc).length === 0, 1000);
  const stale = new Set(visibleOptions(doc));
  const fresh = () => optionsFor(trigger).filter((o) => !stale.has(o));

  let options: HTMLElement[] | null = null;
  // Prøv mus først, så tastatur (Enter/pil ned) hvis listen ikke åpnet seg.
  for (const open of ["mouse", "keyboard"]) {
    if (open === "mouse") realClick(trigger);
    else {
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

  let i = match(texts(options));
  // Lange lister (f.eks. alle verdens språk) tegner bare det som er synlig: scroll til vi finner det.
  const scroller = scrollContainer(options[0]!.closest('[role="listbox"]') ?? options[0]!);
  for (let step = 0; i < 0 && scroller && step < 80; step++) {
    const before = scroller.scrollTop;
    scroller.scrollTop += Math.max(scroller.clientHeight * 0.8, 40);
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(120);
    options = fresh();
    i = match(texts(options));
    if (scroller.scrollTop === before) break; // nådd bunnen
  }
  if (i < 0) {
    await closeListbox(trigger);
    return false;
  }

  const chosen = await chooseOption(options[i]!, i, trigger);
  simulateBlur(trigger); // som når brukeren går videre til neste felt
  if (!chosen) return false;
  // Står knappen fortsatt på «Select One», ble valget ikke registrert.
  if (!(trigger instanceof HTMLInputElement) && PLACEHOLDER_TRIGGER.test(norm(trigger.textContent ?? ""))) return false;
  return true;
}

/**
 * Meny som nedtrekksliste (role="menu" med role="menuitem" som barn, f.eks. Jobbnorges
 * jn-dropdown-menu). Klikker riktig menyvalg direkte, og åpner menyen først hvis det trengs.
 */
export async function pickFromMenu(menu: HTMLElement, match: OptionMatcher): Promise<boolean> {
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  const i = match(items.map((it) => (it.textContent ?? "").trim()));
  const item = items[i];
  if (!item) return false;
  const text = norm(item.textContent ?? "");
  const chosen = () =>
    item.hasAttribute("selected") || item.getAttribute("aria-checked") === "true" || norm(menu.getAttribute("button-text") ?? "") === text;
  if (chosen()) return true;
  // Mange menyer lytter på klikk på menyvalgene selv når menyen er lukket. Ellers: åpne først.
  realClick(item);
  if (await waitFor(chosen, 600)) return true;
  const opener = menu.shadowRoot?.querySelector<HTMLElement>('[aria-haspopup], button') ?? menu;
  realClick(opener);
  await waitFor(() => isVisible(item), 1000);
  realClick(item);
  return Boolean(await waitFor(chosen, 1000));
}

// ---------------------------------------------------------------- søkefelt

const nonEmpty = <T>(xs: T[]) => (xs.length ? xs : null);

/**
 * Skriv som en bruker: ett tastetrykk per tegn. Mange søkelister (bl.a. react-select, som brukes av
 * Greenhouse og mange andre) åpner seg ikke når hele verdien settes på én gang, bare ved tasting.
 */
export function typeLikeUser(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const set = (v: string) => (setter ? setter.call(el, v) : (el.value = v));
  set("");
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "deleteContentBackward" }));
  let current = "";
  for (const ch of value) {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent("keypress", { key: ch, bubbles: true, cancelable: true, composed: true }));
    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: ch }));
    current += ch;
    set(current);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: ch }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: ch, bubbles: true, cancelable: true, composed: true }));
  }
}

/**
 * Treff uten role="option" (noen sider viser forslag som vanlige liste-elementer): synlige,
 * korte elementer med forslag-aktige klassenavn som inneholder søkeordet. Brukes bare for
 * elementer som dukket opp etter at vi skrev, så vi ikke klikker på tilfeldig tekst.
 */
function looseOptions(doc: Document, term: string): HTMLElement[] {
  const want = norm(term).split(" ")[0] ?? "";
  if (want.length < 2) return [];
  const all = Array.from(
    doc.querySelectorAll<HTMLElement>('li, [class*="option" i], [class*="result" i], [class*="suggest" i], [class*="dropdown-item" i], [class*="location" i]'),
  ).filter((o) => {
    const t = norm(o.textContent ?? "");
    return t.length > 0 && t.length < 120 && t.includes(want) && !o.querySelector("input, textarea, select, button") && isVisible(o);
  });
  // Innerste element, så vi klikker på selve forslaget og ikke hele listen.
  return all.filter((o) => !all.some((other) => other !== o && o.contains(other)));
}

/** Søkefelt der man må velge fra en liste (autocomplete, react-select o.l.). Fritekst blir ofte tømt ved blur. */
export function isSearchInput(el: HTMLInputElement): boolean {
  if (el.type !== "text" && el.type !== "search" && el.type !== "") return false;
  if (el.getAttribute("role") === "combobox" || el.hasAttribute("aria-autocomplete")) return true;
  if (el.getAttribute("aria-haspopup") === "listbox") return true;
  const field = hintedFieldContainer(el) ?? el.parentElement?.parentElement;
  if (HINT_SEARCH_MARKERS.length && field?.querySelector(HINT_SEARCH_MARKERS.join(", "))) return true;
  // Uten ARIA: en forslagsliste rett ved siden av feltet (f.eks. Lever sitt stedsfelt).
  const parent = el.parentElement;
  return Boolean(
    parent?.querySelector('[role="listbox"], [class*="autocomplete" i], [class*="typeahead" i], [class*="suggest" i], [class*="dropdown-results" i], [class*="dropdown-container" i]'),
  );
}

/**
 * Søkefelt: skriv inn søkeordet, vent på treff (de fleste lister viser treff mens man skriver;
 * noen, som Workday, først etter Enter), og velg det beste treffet. Prøver søkeordene i rekkefølge.
 * Uten treff tømmes feltet igjen, så det ikke står igjen fritekst som siden ikke godtar.
 */
export async function fillSearchInput(el: HTMLInputElement, terms: string[], opts: { loose?: boolean; fallbackText?: string } = {}): Promise<boolean> {
  const doc = el.ownerDocument;
  const type = (v: string) => typeLikeUser(el, v);
  await waitFor(() => visibleOptions(doc).length === 0, 800);
  log("søkefelt", describeEl(el), "søkeord:", terms);
  for (const term of terms) {
    const stale = new Set(visibleOptions(doc));
    const fresh = () => {
      const f = visibleOptions(doc).filter((o) => !stale.has(o));
      return f.length ? f : null;
    };
    simulateFocus(el);
    type(term);
    // Vent på treff mens man skriver først. Enter med en gang kunne valgt første treff før vi fikk se listen.
    const looseBefore = new Set(looseOptions(doc, term));
    const freshOrLoose = () => fresh() ?? nonEmpty(looseOptions(doc, term).filter((o) => !looseBefore.has(o)));
    let options = await waitFor(freshOrLoose, 1500);
    if (!options) {
      for (const t of ["keydown", "keypress", "keyup"] as const) key(el, t, "Enter");
      options = await waitFor(freshOrLoose, 3000);
    }
    log(`søk «${term}»:`, options ? `${options.length} treff` : "ingen treff funnet");
    if (options) {
      const texts = options.map((o) => ({ text: optionLabel(o) }));
      let i = bestOptionIndex(texts, term, 2);
      if (i < 0 && opts.loose) i = bestOptionIndex(texts, term, 1);
      if (i >= 0 && (await chooseOption(options[i]!, i, el))) {
        simulateBlur(el);
        return true;
      }
    }
    // Ingen treff (eller valget ble ikke registrert): tøm feltet og lukk listen før neste søkeord.
    type("");
    key(el, "keydown", "Escape");
    key(el, "keyup", "Escape");
    await waitFor(() => visibleOptions(doc).length === 0, 800);
  }
  // Ingenting å velge: la teksten stå. Godtar siden fritekst, er feltet utfylt; krever den et valg
  // fra listen, tømmer den feltet selv. Det er bedre enn at vi tømmer et felt som godtar fritekst.
  if (opts.fallbackText) {
    type(opts.fallbackText);
    simulateBlur(el);
    return el.value === opts.fallbackText;
  }
  simulateBlur(el);
  return false;
}

