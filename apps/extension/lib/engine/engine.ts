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
  latestEducation,
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
): { matches: Match[]; adapter: string | null; unrecognized: string[] } {
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
  const unclassifiedFiles: HTMLInputElement[] = [];
  let fileInputs = 0;
  for (const el of scanFields(doc)) {
    // Innloggingsbokser («Log ind», e-post + passord) hører ikke til søknaden.
    if (inLoginForm(el)) continue;
    const isFile = el instanceof HTMLInputElement && el.type === "file";
    if (isFile) fileInputs++;
    const override = overrides.get(el) ?? (isDialCodeSelect(el) ? "country" : undefined);
    const descriptor = describeField(el);
    const result = override ? { key: override, confidence: 1 } : classifyField(descriptor);
    if (result) matches.push({ el, result });
    else if (isFile) unclassifiedFiles.push(el as HTMLInputElement);
    else {
      const text = descriptor.label || descriptor.ariaLabel || descriptor.nearbyText || descriptor.placeholder || descriptor.name;
      if (text) unrecognized.push(text);
    }
  }
  // Et filfelt uten gjenkjennelig tekst får CV-en bare hvis det er det eneste på siden.
  if (fileInputs === 1 && unclassifiedFiles.length === 1) {
    matches.push({ el: unclassifiedFiles[0]!, result: { key: "cvFile", confidence: 0.5 } });
  }
  return { matches, adapter: adapter?.name ?? null, unrecognized };
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

function base64ToFile(f: FilePayload): File {
  const bin = atob(f.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name, { type: f.mime });
}

/** Ett felt per type for de fleste nøkler. Unntaket er e-post, der «bekreft e-post» også skal fylles. */
const MULTI_ALLOWED: FieldKey[] = ["email", "country", "city"];

export async function fillDocument(payload: FillPayload, doc: Document = document): Promise<FrameReport> {
  // Gjentakende seksjoner først: de klikker «Legg til» og fyller hver blokk med sin egen oppføring.
  const sections = await fillRepeatingSections(payload, doc);
  const fields: FieldReport[] = [...sections.fields];

  const classified = classifyDocument(doc);
  const { adapter } = classified;
  const matches = classified.matches.filter((m) => !sections.handled.has(m.el));
  const unrecognized = classified.unrecognized;
  const used = new Set<FieldKey>();
  /** Tekstfelt vi fylte, for kontrollrunden etterpå. */
  const filledText: { el: HTMLInputElement | HTMLTextAreaElement; value: string }[] = [];

  // Sikreste treff først, så de vinner hvis flere felt matcher samme nøkkel.
  matches.sort((a, b) => b.result.confidence - a.result.confidence);

  for (const { el, result } of matches) {
    const { key, confidence } = result;
    const report: FieldReport = { key, label: FIELD_LABELS[key], confidence, status: "no-value" };
    fields.push(report);

    if (used.has(key) && !MULTI_ALLOWED.includes(key)) {
      report.status = "skipped-has-value";
      continue;
    }
    // Første alternativ i en landskode-liste («AC +247») er bare et alfabetisk standardvalg, ikke brukerens.
    const defaultDialCode = isDialCodeSelect(el) && (el as HTMLSelectElement).selectedIndex === 0;
    if (!payload.overwrite && hasValue(el) && !defaultDialCode) {
      report.status = "skipped-has-value";
      continue;
    }
    const value = resolveValue(key, payload.profile);
    if (!value) continue;

    let ok = false;
    try {
      if (value.kind === "file") {
        const file = payload.files[key as keyof FillPayload["files"]];
        if (el instanceof HTMLInputElement && el.type === "file" && file) {
          // Felt som tar imot flere filer får også ekstra dokumenter (karakterutskrift) sammen med CV-en.
          const extras = key === "cvFile" && el.multiple ? (payload.cvExtras ?? []) : [];
          ok = setFileValue(el, [file, ...extras].map(base64ToFile));
        }
      } else if (el instanceof HTMLSelectElement && key === "birthDate" && fillDateSelects(el, value.value) > 0) {
        // Dato delt i flere lister (år/måned/dag): alle delene er fylt.
        ok = true;
      } else if (el instanceof HTMLSelectElement) {
        const options = Array.from(el.options);
        const i = optionMatcher(key, value.value, payload.profile)(options.map((o) => o.text));
        ok = i >= 0 ? setSelectValue(el, options[i]!.text) : setSelectValue(el, value.value);
      } else if (el instanceof HTMLInputElement && isSearchInput(el)) {
        // Søkefelt (react-select, autocomplete …): skriv, vent på treff og velg fra listen.
        ok = await fillSearchInput(el, searchTermsFor(key, value.value, payload.profile), {
          loose: key === "fieldOfStudy",
          fallbackText: value.value,
        });
      } else if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !el.isContentEditable) {
        // Egendefinert nedtrekksliste (knapp som åpner en liste).
        ok = await pickFromListbox(el, optionMatcher(key, value.value, payload.profile));
      } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const text = key === "birthDate" ? formatDateForInput(value.value, (el as HTMLInputElement).type) : value.value;
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
    const sure = confidence >= HIGH_CONFIDENCE;
    report.status = sure ? "filled" : "uncertain";
    highlight(el, sure ? "filled" : "uncertain", sure ? `Masterkey: ${FIELD_LABELS[key]}` : `Masterkey: ${FIELD_LABELS[key]}? Sjekk at dette stemmer.`);
  }

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

  return { url: doc.location?.href ?? "", adapter, detected: matches.length + groups.detected + sections.fields.length, fields, unrecognized };
}

/** Avkrysningsbokser og radioknapper: kryss av alternativet som passer med profilen. */
function fillChoiceGroups(payload: FillPayload, doc: Document): { detected: number; fields: FieldReport[] } {
  const fields: FieldReport[] = [];
  let detected = 0;
  for (const group of scanChoiceGroups(doc)) {
    const result = group.question ? classifyField({ tag: "input", type: "text", label: group.question }) : null;
    if (!result) continue;
    detected++;
    const report: FieldReport = { key: result.key, label: FIELD_LABELS[result.key], confidence: result.confidence, status: "no-value" };
    fields.push(report);

    if (!payload.overwrite && group.options.some((o) => o.el.checked)) {
      report.status = "skipped-has-value";
      continue;
    }
    const value = resolveValue(result.key, payload.profile);
    if (!value || value.kind !== "text") continue;
    // Krever minst «starter med»-treff, så vi ikke krysser av noe som bare ligner litt.
    const option = group.options[bestOptionIndex(group.options, value.value, 2)];
    if (!option) continue;

    checkOption(option.el);
    const sure = result.confidence >= HIGH_CONFIDENCE;
    report.status = sure ? "filled" : "uncertain";
    highlight(option.el.labels?.[0] ?? option.el, sure ? "filled" : "uncertain", `Masterkey: ${FIELD_LABELS[result.key]}`);
  }
  return { detected, fields };
}

export function createEngine(doc: Document = document): EngineApi {
  return {
    analyze() {
      const { matches, adapter } = classifyDocument(doc);
      const keys = [...new Set(matches.map((m) => m.result.key))];
      const cvTakesExtras =
        !keys.includes("diplomaFile") && matches.some((m) => m.result.key === "cvFile" && m.el instanceof HTMLInputElement && m.el.multiple);
      return { keys, adapter, lang: pageLanguage(doc), cvTakesExtras };
    },
    fill: (payload) => fillDocument(payload, doc),
    clear: () => clearHighlights(doc),
  };
}
