import {
  bestDegreeOptionIndex,
  classifyField,
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
} from "@soknadsprofil/shared";
import { fillSearchInput, isSearchInput, pickFromListbox } from "./picker";
import type { EngineApi, FieldReport, FilePayload, FillPayload, FrameReport } from "../types";
import { findAdapter } from "./adapters";
import { fillRepeatingSections } from "./sections";
import {
  bestOptionIndex,
  checkOption,
  clearHighlights,
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
    const isFile = el instanceof HTMLInputElement && el.type === "file";
    if (isFile) fileInputs++;
    const override = overrides.get(el);
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

/** Velger riktig alternativ i en liste for en felttype. */
function optionMatcher(key: FieldKey, value: string, profile: FullProfile) {
  return (texts: string[]) => {
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

function base64ToFile(f: FilePayload): File {
  const bin = atob(f.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], f.name, { type: f.mime });
}

/** Ett felt per type for de fleste nøkler. Unntaket er e-post, der «bekreft e-post» også skal fylles. */
const MULTI_ALLOWED: FieldKey[] = ["email", "country"];

export async function fillDocument(payload: FillPayload, doc: Document = document): Promise<FrameReport> {
  // Gjentakende seksjoner først: de klikker «Legg til» og fyller hver blokk med sin egen oppføring.
  const sections = await fillRepeatingSections(payload, doc);
  const fields: FieldReport[] = [...sections.fields];

  const classified = classifyDocument(doc);
  const { adapter } = classified;
  const matches = classified.matches.filter((m) => !sections.handled.has(m.el));
  const unrecognized = classified.unrecognized;
  const used = new Set<FieldKey>();

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
    if (!payload.overwrite && hasValue(el)) {
      report.status = "skipped-has-value";
      continue;
    }
    const value = resolveValue(key, payload.profile);
    if (!value) continue;

    let ok = false;
    try {
      if (value.kind === "file") {
        const file = payload.files[key as keyof FillPayload["files"]];
        if (el instanceof HTMLInputElement && el.type === "file" && file) ok = setFileValue(el, base64ToFile(file));
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
    const sure = confidence >= HIGH_CONFIDENCE;
    report.status = sure ? "filled" : "uncertain";
    highlight(el, sure ? "filled" : "uncertain", sure ? `Masterkey: ${FIELD_LABELS[key]}` : `Masterkey: ${FIELD_LABELS[key]}? Sjekk at dette stemmer.`);
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
      return { keys: [...new Set(matches.map((m) => m.result.key))], adapter };
    },
    fill: (payload) => fillDocument(payload, doc),
    clear: () => clearHighlights(doc),
  };
}
