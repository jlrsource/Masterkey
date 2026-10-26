import {
  bestDegreeOptionIndex,
  classifyField,
  countryIso2,
  dialCode,
  englishCountry,
  FIELD_LABELS,
  fieldOfStudySearchTerms,
  formatDateForInput,
  HIGH_CONFIDENCE,
  isConsentQuestion,
  languageOptionPicks,
  latestEducation,
  QUESTION_DEPENDENT_KEYS,
  PREF_CHOICE_KEYS,
  prefAnswer,
  prefDisplay,
  prefOptionIndex,
  resolveValue,
  type Classification,
  type FieldKey,
  type FullProfile,
  type DocLanguage,
} from "@soknadsprofil/shared";
import { fillSearchInput, isSearchInput, pickFromListbox } from "./picker";
import type { EngineApi, FieldReport, FilePayload, FillPayload, FrameReport } from "../types";
import { findAdapter } from "./adapters";
import { fillRepeatingSections } from "./sections";
import { base64ToFile, fillUploadPanels, fillUploadWidgets, findUploadPanels, findUploadWidgets, uploadPanelInputs } from "./uploads";
import { collectAnswers, fillSavedAnswers, fillSavedChoice, questionOf } from "./answers";
import { log } from "./util";
import {
  bestOptionIndex,
  checkOption,
  clearHighlights,
  fillDateSelects,
  inLoginForm,
  describeField,
  hasValue,
  highlight,
  scanChoiceGroups,
  scanFields,
  setContentEditable,
  setFileValue,
  isVisible,
  setSelectValue,
  setTextValue,
  type FillableElement,
} from "./dom";

interface Match {
  el: FillableElement;
  result: Classification;
}

/** En liste med retningsnumre («NO +47», «+46 Sverige» …) er en landskode-liste, uansett label. */
function isDialCodeSelect(el: Element): boolean {
  if (!(el instanceof HTMLSelectElement) || el.options.length < 5) return false;
  const withDial = Array.from(el.options).filter((o) => /\+\d{1,4}\b/.test(o.text)).length;
  return withDial >= el.options.length * 0.6;
}

/** Klassifiser alle felt i dokumentet. Adapter-regler går foran den generiske klassifisereren. */
export function classifyDocument(
  doc: Document = document,
  hostname = doc.location?.hostname ?? "",
): { matches: Match[]; adapter: string | null; unrecognized: string[]; unrecognizedEls: FillableElement[] } {
  const adapter = findAdapter(hostname);
  const overrides = new Map<Element, FieldKey>();
  for (const rule of adapter?.fields ?? []) {
    doc.querySelectorAll(rule.selector).forEach((el) => {
      // Workday legger data-automation-id på en wrapper. Finn selve feltet inni.
      const field = el.matches("input, textarea, select") ? el : el.querySelector("input, textarea, select");
      if (field) overrides.set(field, rule.key);
    });
  }

  const matches: Match[] = [];
  const unrecognized: string[] = [];
  const unrecognizedEls: FillableElement[] = [];
  const unclassifiedFiles: HTMLInputElement[] = [];
  let fileInputs = 0;
  for (const el of scanFields(doc)) {
    // Innloggingsbokser («Log ind», e-post + passord) hører ikke til søknaden.
    if (inLoginForm(el)) continue;
    const isFile = el instanceof HTMLInputElement && el.type === "file";
    // Filfelt i et skjult panel (f.eks. Webcruiters «Last opp ny fil» før panelet er åpnet) hører ikke til skjemaet ennå.
    if (isFile && el.parentElement && !isVisible(el.parentElement)) continue;
    if (isFile) fileInputs++;
    const override = overrides.get(el) ?? (isDialCodeSelect(el) ? "country" : undefined);
    const descriptor = describeField(el);
    const result = override ? { key: override, confidence: 1 } : classifyField(descriptor);
    if (result) matches.push({ el, result });
    else if (isFile) unclassifiedFiles.push(el as HTMLInputElement);
    else {
      const text = descriptor.label || descriptor.ariaLabel || descriptor.nearbyText || descriptor.placeholder || descriptor.name;
      if (text) unrecognized.push(text);
      unrecognizedEls.push(el);
    }
  }
  // Et filfelt uten gjenkjennelig tekst får CV-en bare hvis det er det eneste på siden.
  if (fileInputs === 1 && unclassifiedFiles.length === 1) {
    matches.push({ el: unclassifiedFiles[0]!, result: { key: "cvFile", confidence: 0.5 } });
  }
  return { matches, adapter: adapter?.name ?? null, unrecognized, unrecognizedEls };
}

/**
 * Søkeord for et søkefelt, i rekkefølge. Mange lister er på engelsk, så land oversettes,
 * sted prøves også med land («Oslo, Norway»), og fagfelt bruker AI-søkeordene fra profilen.
 */
function searchTermsFor(key: FieldKey, value: string, profile: FullProfile): string[] {
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x?.trim())))];
  const country = profile.personal?.country;
  switch (key) {
    case "country":
      return uniq([englishCountry(value), value]);
    case "city":
    case "studyCity":
      return uniq([value, `${value}, ${englishCountry(country) ?? country ?? ""}`.replace(/, $/, "")]);
    case "fieldOfStudy":
      return uniq([...(latestEducation(profile)?.field_of_study_en ?? []), ...fieldOfStudySearchTerms(value)]);
    default:
      return [value];
  }
}

/** Alternativet med et tallintervall som inneholder `n` («0–2 år», «3-5», «10+ years»), eller -1. */
function rangeOptionIndex(texts: string[], n: number): number {
  return texts.findIndex((t) => {
    const nums = (t.match(/\d+/g) ?? []).map(Number);
    if (!nums.length) return false;
    if (/\+|over|mer enn|more than|or more|eller mer/i.test(t)) return n >= nums[0]!;
    if (/under|mindre enn|less than|fewer than/i.test(t)) return n < nums[0]!;
    if (nums.length >= 2) return n >= nums[0]! && n <= nums[1]!;
    return n === nums[0];
  });
}

/**
 * Landskode-lister for telefon («NO +47», «+47 Norway», «Norway (+47)»): velg ut fra retningsnummeret
 * i profilens telefonnummer, ellers landets ISO-kode. Bare når listen faktisk har retningsnumre.
 */
function countryCodeOptionIndex(texts: string[], country: string, profile: FullProfile): number {
  if (!texts.some((t) => /\+\d{1,4}\b/.test(t))) return -1;
  const dial = dialCode(profile.personal?.phone) ?? (countryIso2(country) === "NO" ? "47" : null);
  const iso = countryIso2(country);
  const name = englishCountry(country) ?? country;
  const hasDial = (t: string) => dial !== null && new RegExp(`\\+${dial}(?!\\d)`).test(t);
  // Flere land kan dele retningsnummer (+1, +47 for Svalbard): foretrekk ISO-kode/navn i tillegg.
  const both = texts.findIndex((t) => hasDial(t) && ((iso && new RegExp(`\\b${iso}\\b`).test(t)) || t.toLowerCase().includes(name.toLowerCase()) || t.toLowerCase().includes(country.toLowerCase())));
  if (both >= 0) return both;
  const byDial = texts.findIndex(hasDial);
  if (byDial >= 0) return byDial;
  return iso ? texts.findIndex((t) => new RegExp(`^\\s*${iso}\\b`).test(t)) : -1;
}

/** Velger riktig alternativ i en liste for en felttype. */
function optionMatcher(key: FieldKey, value: string, profile: FullProfile) {
  return (texts: string[]) => {
    // Faste søknadssvar: «yes» → «Yes»/«Ja», «remote» → «Remote» osv.
    if (PREF_CHOICE_KEYS.includes(key) || key === "heardAbout") return prefOptionIndex(key, texts, value);
    if (key === "yearsExperience") {
      const i = rangeOptionIndex(texts, Number(value));
      if (i >= 0) return i;
    }
    if (key === "country") {
      const i = countryCodeOptionIndex(texts, value, profile);
      if (i >= 0) return i;
    }
    if (key === "degree") {
      const edu = latestEducation(profile);
      const i = bestDegreeOptionIndex(texts, value, [edu?.field_of_study, edu?.school].filter(Boolean).join(" "));
      if (i >= 0) return i;
    }
    for (const term of searchTermsFor(key, value, profile)) {
      const i = bestOptionIndex(texts.map((text) => ({ text })), term, 2);
      if (i >= 0) return i;
    }
    return -1;
  };
}

// Ordgrenser som også virker rundt æøå (\b gjør ikke det).
const words = (list: string) => new RegExp(`(?<!\\p{L})(${list})(?!\\p{L})`, "giu");
const NORWEGIAN_WORDS = words("og|ikke|eller|søknad|stilling|fornavn|etternavn|utdanning|erfaring|neste|lagre|velg|på|med|din|ditt|du");
const ENGLISH_WORDS = words("and|the|or|application|position|first name|last name|education|experience|next|save|select|your|with|you");

/**
 * Sidens språk: en grov telling av vanlige ord, ellers lang-attributtet.
 * Teksten vinner når den er tydelig, siden mange sider har lang="en" uansett språk.
 */
export function pageLanguage(doc: Document): DocLanguage | null {
  const text = (doc.body?.innerText || doc.body?.textContent || "").slice(0, 20000);
  const no = text.match(NORWEGIAN_WORDS)?.length ?? 0;
  const en = text.match(ENGLISH_WORDS)?.length ?? 0;
  if (no + en >= 6 && Math.max(no, en) >= 2 * Math.min(no, en)) return no > en ? "no" : "en";
  const lang = doc.documentElement.lang.toLowerCase();
  if (/^(nb|nn|no)\b/.test(lang)) return "no";
  if (/^en\b/.test(lang)) return "en";
  return no === en ? null : no > en ? "no" : "en";
}


/** Viser siden at den jobber med filen («Analyzing resume...» hos Lever, eller aria-busy)? */
function pageIsBusy(doc: Document): boolean {
  const busy = Array.from(
    doc.querySelectorAll<HTMLElement>('[class*="upload-working" i], [class*="uploading" i], [class*="parsing" i], [class*="analyzing" i], [aria-busy="true"]'),
  );
  if (busy.some((el) => isVisible(el))) return true;
  return Array.from(doc.querySelectorAll<HTMLElement>("span, div, p")).some(
    (el) => el.childElementCount === 0 && /analy[sz]ing (resume|cv)|parsing (resume|cv)|analyserer cv|leser cv/i.test(el.textContent ?? "") && isVisible(el),
  );
}

/**
 * Etter CV-opplasting: vent til siden eventuelt har fylt ut felt fra CV-en selv (Lever gjør det
 * når den er ferdig med «Analyzing resume...»). Returnerer feltene som var tomme før og har fått verdi.
 * Viser ikke siden noe arbeid og ingenting endres innen 4 sekunder, regner vi med at den ikke leser CV-en.
 */
async function waitForPageAutofill(doc: Document, before: Map<Element, string | null>, value: (el: Element) => string | null): Promise<Set<Element>> {
  const changed = () => Array.from(before).filter(([el, v]) => v === "" && (value(el) ?? "") !== "").map(([el]) => el);
  const start = Date.now();
  let last = 0;
  let stableSince = Date.now();
  let sawBusy = false;
  while (Date.now() - start < 30000) {
    await new Promise((r) => setTimeout(r, 250));
    if (pageIsBusy(doc)) {
      if (!sawBusy) log("venter mens siden leser CV-en …");
      sawBusy = true;
      stableSince = Date.now();
      continue;
    }
    const n = changed().length;
    if (n !== last) {
      last = n;
      stableSince = Date.now();
    }
    if (n === 0 && !sawBusy && Date.now() - start > 4000) break;
    if (Date.now() - stableSince > 1200 && (n > 0 || sawBusy)) break;
  }
  return new Set(changed());
}

/** Ett felt per type for de fleste nøkler. Unntaket er e-post, der «bekreft e-post» også skal fylles. */
const MULTI_ALLOWED: FieldKey[] = ["email", "country", "city"];

export async function fillDocument(payload: FillPayload, doc: Document = document): Promise<FrameReport> {
  // Gjentakende seksjoner først: de klikker «Legg til» og fyller hver blokk med sin egen oppføring.
  const sections = await fillRepeatingSections(payload, doc);
  const fields: FieldReport[] = [...sections.fields];

  const classified = classifyDocument(doc);
  const { adapter } = classified;
  const panelInputs = uploadPanelInputs(doc);
  const matches = classified.matches.filter((m) => !sections.handled.has(m.el) && !panelInputs.has(m.el));
  const unrecognized = classified.unrecognized;
  const used = new Set<FieldKey>();
  /** Tekstfelt vi fylte, for kontrollrunden etterpå. */
  const filledText: { el: HTMLInputElement | HTMLTextAreaElement; value: string }[] = [];

  // Filer først: noen sider (Lever) leser CV-en og fyller ut felt fra den. Det skal skje før vi
  // fyller ut, så profilens verdier vinner. Ellers sikreste treff først, så de vinner hvis flere
  // felt matcher samme nøkkel.
  const isFileInput = (el: Element) => el instanceof HTMLInputElement && el.type === "file";
  matches.sort((a, b) => Number(isFileInput(b.el)) - Number(isFileInput(a.el)) || b.result.confidence - a.result.confidence);
  const textValue = (el: Element) => (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : null);
  const valuesBefore = new Map(matches.filter((m) => !isFileInput(m.el)).map((m) => [m.el, textValue(m.el)]));
  let cvUploaded = false;
  let settled = false;
  /** Felt siden fylte selv etter at vi lastet opp CV-en (Levers CV-lesing). De er ikke brukerens. */
  let filledByPage = new Set<Element>();
  /** Felt vi kjente igjen, men der profilen ikke har noe svar: kanskje brukeren har svart før. */
  const noValue: FillableElement[] = [];

  // Har siden eget felt for vitnemål, skal karakterutskriften dit og ikke sammen med CV-en.
  const hasDiplomaField = matches.some((m) => m.result.key === "diplomaFile");

  for (const { el, result } of matches) {
    const { key, confidence } = result;
    if (cvUploaded && !settled && !isFileInput(el)) {
      settled = true;
      filledByPage = await waitForPageAutofill(doc, valuesBefore, textValue);
      if (filledByPage.size) log(`siden fylte ${filledByPage.size} felt fra CV-en selv; profilen vinner`);
    }
    const report: FieldReport = { key, label: FIELD_LABELS[key], confidence, status: "no-value" };
    fields.push(report);

    if (used.has(key) && !MULTI_ALLOWED.includes(key)) {
      report.status = "skipped-has-value";
      continue;
    }
    // Første alternativ i en landskode-liste («AC +247») er bare et alfabetisk standardvalg, ikke brukerens.
    const defaultDialCode = isDialCodeSelect(el) && (el as HTMLSelectElement).selectedIndex === 0;
    if (!payload.overwrite && hasValue(el) && !defaultDialCode && !filledByPage.has(el)) {
      report.status = "skipped-has-value";
      continue;
    }
    const question = questionOf(el);
    // Samtykker og erklæringer krysser vi aldri av.
    if (PREF_CHOICE_KEYS.includes(key) && isConsentQuestion(question)) continue;
    // Arbeidstillatelse avhenger av landet spørsmålet nevner. Uten land er svaret en gjetning (Norge).
    const dependent = QUESTION_DEPENDENT_KEYS.includes(key);
    const pref = dependent ? prefAnswer(key, payload.profile, question) : null;
    const value = pref ? ({ kind: "text", value: pref.value } as const) : dependent ? null : resolveValue(key, payload.profile);
    if (!value) {
      noValue.push(el);
      // Siden gjettet en verdi fra CV-en som profilen ikke har (f.eks. «Current company» uten nåværende jobb).
      if (filledByPage.has(el) && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        setTextValue(el, "");
        log(`tømte «${FIELD_LABELS[key]}», som siden fylte fra CV-en (finnes ikke i profilen)`);
      }
      continue;
    }

    let ok = false;
    try {
      if (value.kind === "file") {
        const file = payload.files[key as keyof FillPayload["files"]];
        if (el instanceof HTMLInputElement && el.type === "file" && file) {
          // Felt som tar imot flere filer får også ekstra dokumenter (karakterutskrift) sammen med CV-en.
          const extras = key === "cvFile" && el.multiple && !hasDiplomaField ? (payload.cvExtras ?? []) : [];
          const all = [file, ...extras];
          ok = setFileValue(el, all.map(base64ToFile));
          // Vis filnavnene i popupen, så brukeren ser hva som ble lagt ved.
          report.label = `${FIELD_LABELS[key]}: ${all.map((f) => f.name).join(", ")}`;
          if (key === "cvFile" && el.multiple && !hasDiplomaField && !extras.length) report.label += " (fant ingen vitnemål/karakterutskrift i profilen)";
          log(`filfelt ${el.multiple ? "(flere filer) " : ""}← ${all.map((f) => f.name).join(", ")} ${ok ? "✓" : "✗"}`);
          if (ok && key === "cvFile") cvUploaded = true;
        }
      } else if (el instanceof HTMLSelectElement && key === "birthDate" && fillDateSelects(el, value.value) > 0) {
        // Dato delt i flere lister (år/måned/dag): alle delene er fylt.
        ok = true;
      } else if (el instanceof HTMLSelectElement) {
        const options = Array.from(el.options);
        const i = optionMatcher(key, value.value, payload.profile)(options.map((o) => o.text));
        ok = i >= 0 ? setSelectValue(el, options[i]!.text) : !PREF_CHOICE_KEYS.includes(key) && setSelectValue(el, value.value);
      } else if (el instanceof HTMLInputElement && isSearchInput(el)) {
        // Søkefelt (react-select, autocomplete …): skriv, vent på treff og velg fra listen.
        ok = await fillSearchInput(el, searchTermsFor(key, value.value, payload.profile), {
          loose: key === "fieldOfStudy",
          fallbackText: value.value,
          mustContain: key === "city" || key === "studyCity" ? value.value : undefined,
        });
      } else if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !el.isContentEditable) {
        // Egendefinert nedtrekksliste (knapp som åpner en liste).
        ok = await pickFromListbox(el, optionMatcher(key, value.value, payload.profile));
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const text =
          key === "birthDate"
            ? formatDateForInput(value.value, (el as HTMLInputElement).type)
            : PREF_CHOICE_KEYS.includes(key)
              ? prefDisplay(key, value.value)
              : value.value;
        setTextValue(el, text);
        ok = true;
      } else {
        setContentEditable(el, value.value);
        ok = true;
      }
    } catch (e) {
      console.warn("[Masterkey] kunne ikke fylle felt", key, e);
    }

    if (!ok) {
      report.status = "failed";
      continue;
    }
    used.add(key);
    if ((el instanceof HTMLInputElement && el.type !== "file") || el instanceof HTMLTextAreaElement) filledText.push({ el, value: el.value });
    const sure = confidence >= HIGH_CONFIDENCE && pref?.sure !== false;
    report.status = sure ? "filled" : "uncertain";
    highlight(el, sure ? "filled" : "uncertain", sure ? `Masterkey: ${FIELD_LABELS[key]}` : `Masterkey: ${FIELD_LABELS[key]}? Sjekk at dette stemmer.`);
  }

  // Husket svar: felt ingen regel kjente igjen (eller profilen ikke har svar på), men som brukeren
  // har svart på i en tidligere søknad.
  const rest = [...classified.unrecognizedEls.filter((el) => !sections.handled.has(el) && !panelInputs.has(el)), ...noValue].filter(
    (el) => !(el instanceof HTMLInputElement && el.type === "file"),
  );
  const remembered = await fillSavedAnswers(payload.profile, rest, payload.overwrite);
  fields.push(...remembered);

  // Kontrollrunde: noen sider tømmer felt etterpå (f.eks. «By» slås opp fra postnummeret når
  // postnummerfeltet mister fokus). Fyll dem én gang til hvis de ble tømt.
  if (filledText.length) {
    await new Promise((r) => setTimeout(r, 700));
    for (const { el, value } of filledText) {
      if (el.isConnected && el.value === "" && value) setTextValue(el, value);
    }
  }

  const groups = fillChoiceGroups(payload, doc);
  fields.push(...groups.fields);

  // Vedleggsfelt der filfeltet først dukker opp etter klikk på «+» (SuccessFactors).
  const uploads = [...(await fillUploadWidgets(payload, doc)), ...(await fillUploadPanels(payload, doc))];
  fields.push(...uploads);

  return { url: doc.location?.href ?? "", adapter, detected: matches.length + groups.detected + sections.fields.length + uploads.length, fields, unrecognized };
}

/** Avkrysningsbokser og radioknapper: kryss av alternativet som passer med profilen. */
function fillChoiceGroups(payload: FillPayload, doc: Document): { detected: number; fields: FieldReport[] } {
  const fields: FieldReport[] = [];
  let detected = 0;
  for (const group of scanChoiceGroups(doc)) {
    // Samtykker og erklæringer krysser vi aldri av.
    if (isConsentQuestion(group.question)) continue;
    const result = group.question ? classifyField({ tag: "input", type: "text", label: group.question }) : null;
    if (!result) {
      const saved = fillSavedChoice(payload.profile, group, payload.overwrite);
      if (saved) {
        detected++;
        fields.push(saved);
      }
      continue;
    }
    detected++;
    const report: FieldReport = { key: result.key, label: FIELD_LABELS[result.key], confidence: result.confidence, status: "no-value" };
    fields.push(report);

    if (!payload.overwrite && group.options.some((o) => o.el.checked)) {
      report.status = "skipped-has-value";
      continue;
    }
    // Språk som alternativer (Danish / Finnish / Swedish / None of the above): kryss av det brukeren kan.
    if (result.key === "languageProficiency") {
      const picks = languageOptionPicks(group.options.map((o) => o.text), group.question, payload.profile);
      if (picks && (picks.length === 1 || group.options[0]?.el.type === "checkbox")) {
        for (const i of picks) {
          checkOption(group.options[i]!.el);
          highlight(group.options[i]!.el.labels?.[0] ?? group.options[i]!.el, "filled", `Masterkey: ${FIELD_LABELS[result.key]}`);
        }
        report.status = "filled";
        continue;
      }
    }
    // Faste søknadssvar (Ja/Nei, arbeidsform …). Arbeidstillatelse avhenger av landet i spørsmålet.
    const isPref = PREF_CHOICE_KEYS.includes(result.key) || result.key === "heardAbout";
    const pref = isPref ? prefAnswer(result.key, payload.profile, group.question) : null;
    const value = pref ? pref.value : isPref ? null : resolveValue(result.key, payload.profile);
    const text = typeof value === "string" ? value : value?.kind === "text" ? value.value : null;
    if (!text) {
      // Ingen fast svar: kanskje brukeren har svart på akkurat dette spørsmålet før.
      const saved = fillSavedChoice(payload.profile, group, payload.overwrite);
      if (saved) fields.splice(fields.indexOf(report), 1, saved);
      continue;
    }
    // Krever minst «starter med»-treff, så vi ikke krysser av noe som bare ligner litt.
    const i = isPref ? prefOptionIndex(result.key, group.options.map((o) => o.text), text) : bestOptionIndex(group.options, text, 2);
    const option = group.options[i];
    if (!option) continue;

    checkOption(option.el);
    const sure = result.confidence >= HIGH_CONFIDENCE && pref?.sure !== false;
    report.status = sure ? "filled" : "uncertain";
    highlight(option.el.labels?.[0] ?? option.el, sure ? "filled" : "uncertain", `Masterkey: ${FIELD_LABELS[result.key]}`);
  }
  return { detected, fields };
}

export function createEngine(doc: Document = document): EngineApi {
  return {
    analyze() {
      const { matches, adapter } = classifyDocument(doc);
      const keys = [
        ...new Set([
          ...matches.map((m) => m.result.key),
          ...findUploadWidgets(doc).map((w) => w.key),
          // Vedleggspanel: CV-en (og karakterutskriften, som følger med CV-en) lastes opp der.
          ...(findUploadPanels(doc).length ? (["cvFile"] as const) : []),
        ]),
      ];
      return { keys, adapter, lang: pageLanguage(doc) };
    },
    fill: (payload) => fillDocument(payload, doc),
    collectAnswers: () => collectAnswers(doc),
    clear: () => clearHighlights(doc),
  };
}
