import {
  classifyField,
  findSavedAnswer,
  isConsentQuestion,
  normalize,
  PREF_CHOICE_KEYS,
  type FieldKey,
  type FullProfile,
} from "@soknadsprofil/shared";
import type { FieldReport } from "../types";
import {
  bestOptionIndex,
  checkOption,
  describeField,
  FILLED_ATTR,
  hasValue,
  highlight,
  inLoginForm,
  scanChoiceGroups,
  scanFields,
  setSelectValue,
  setTextValue,
  type ChoiceGroup,
  type FillableElement,
} from "./dom";
import { pickFromListbox } from "./picker";
import { log } from "./util";

/**
 * Husket svar: det brukeren selv har svart på tidligere søknader, lagret som standardsvar.
 * Fylles inn når samme spørsmål dukker opp igjen, og samles inn når brukeren ber om det.
 */

/** Spørsmålsteksten til et felt (merkelapp, aria-label eller plassholder). */
export function questionOf(el: FillableElement): string {
  const d = describeField(el);
  return (d.label || d.ariaLabel || d.placeholder || "").replace(/\s*\*\s*$/, "").trim();
}

/** Felt som hører til faste søknadssvar eller standardsvar kan også huskes. Personalia hentes fra profilen. */
const REMEMBERABLE_KEYS: FieldKey[] = [...PREF_CHOICE_KEYS, "noticePeriod", "heardAbout", "availability", "salaryExpectation", "motivation"];

function isRemembered(question: string): boolean {
  if (!question || question.length > 400 || isConsentQuestion(question)) return false;
  const key = classifyField({ tag: "input", type: "text", label: question })?.key;
  return !key || REMEMBERABLE_KEYS.includes(key);
}

/** Fylte extensionen feltet? Bare feltet selv og merkelappen sjekkes (store bokser kan også være merket). */
const filledByUs = (el: Element) =>
  el.hasAttribute(FILLED_ATTR) || Array.from((el as HTMLInputElement).labels ?? []).some((l) => l.hasAttribute(FILLED_ATTR)) || Boolean(el.closest(`label[${FILLED_ATTR}]`));

function shownValue(el: FillableElement): string {
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text.trim() ?? "";
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim();
  return (el.textContent ?? "").trim();
}

function optionTextsOf(group: ChoiceGroup): string[] {
  return group.options.filter((o) => o.el.checked).map((o) => o.text.trim());
}

/** Svar brukeren har fylt inn selv på siden (ikke det extensionen fylte), som spørsmål og svar. */
export function collectAnswers(doc: Document): { question: string; answer: string }[] {
  const out = new Map<string, { question: string; answer: string }>();
  const add = (question: string, answer: string) => {
    if (!answer || !isRemembered(question)) return;
    out.set(normalize(question), { question, answer });
  };
  for (const el of scanFields(doc)) {
    if (el instanceof HTMLInputElement && ["file", "password", "hidden", "checkbox", "radio"].includes(el.type)) continue;
    if (inLoginForm(el) || filledByUs(el) || !hasValue(el)) continue;
    add(questionOf(el), shownValue(el));
  }
  for (const group of scanChoiceGroups(doc)) {
    if (group.options.some((o) => filledByUs(o.el))) continue;
    const checked = optionTextsOf(group);
    if (checked.length) add(group.question.trim(), checked.join(", "));
  }
  return [...out.values()];
}

/** Indeksen til alternativet som tilsvarer et husket svar: likt først, så «starter med». */
function savedOptionIndex(texts: string[], answer: string): number {
  const a = normalize(answer);
  const exact = texts.findIndex((t) => normalize(t) === a);
  return exact >= 0 ? exact : bestOptionIndex(texts.map((text) => ({ text })), answer, 2);
}

/** Fyll felt ingen regel kjente igjen, med svar brukeren har gitt på samme spørsmål før. */
export async function fillSavedAnswers(profile: FullProfile, els: FillableElement[], overwrite: boolean): Promise<FieldReport[]> {
  const reports: FieldReport[] = [];
  const answers = profile.saved_answers ?? [];
  if (!answers.length) return reports;
  for (const el of els) {
    const question = questionOf(el);
    if (!question || isConsentQuestion(question) || (!overwrite && hasValue(el))) continue;
    const match = findSavedAnswer(question, answers);
    if (!match) continue;
    const { answer } = match.answer;
    let ok = false;
    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options);
      const i = savedOptionIndex(options.map((o) => o.text), answer);
      ok = i >= 0 && setSelectValue(el, options[i]!.text);
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setTextValue(el, answer);
      ok = true;
    } else {
      ok = await pickFromListbox(el, (texts) => savedOptionIndex(texts, answer));
    }
    if (!ok) continue;
    const kind = match.exact ? "filled" : "uncertain";
    highlight(el, kind, `Masterkey: husket svar${match.exact ? "" : " (sjekk at det passer)"}`);
    reports.push({ key: "savedAnswer", label: `Husket svar: ${question.slice(0, 50)}`, confidence: match.exact ? 1 : 0.6, status: kind });
    log(`husket svar «${question.slice(0, 50)}» = «${answer.slice(0, 40)}»${match.exact ? "" : " (nesten likt spørsmål)"}`);
  }
  return reports;
}

/** Avkrysningsgrupper ingen regel kjente igjen: velg alternativet(ene) fra et husket svar. */
export function fillSavedChoice(profile: FullProfile, group: ChoiceGroup, overwrite: boolean): FieldReport | null {
  const question = group.question.trim();
  if (!question || isConsentQuestion(question)) return null;
  if (!overwrite && group.options.some((o) => o.el.checked)) return null;
  const match = findSavedAnswer(question, profile.saved_answers ?? []);
  if (!match) return null;
  const texts = group.options.map((o) => o.text);
  // Avkrysningsbokser kan ha flere svar («LinkedIn, Finn»). Radioknapper har ett.
  const parts = group.options[0]?.el.type === "checkbox" ? match.answer.answer.split(/\s*,\s*/) : [match.answer.answer];
  const picked = [...new Set(parts.map((p) => savedOptionIndex(texts, p)).filter((i) => i >= 0))];
  if (!picked.length) return null;
  const kind = match.exact ? "filled" : "uncertain";
  for (const i of picked) {
    const option = group.options[i]!;
    checkOption(option.el);
    highlight(option.el.labels?.[0] ?? option.el, kind, "Masterkey: husket svar");
  }
  log(`husket svar «${question.slice(0, 50)}» = «${match.answer.answer.slice(0, 40)}»`);
  return { key: "savedAnswer", label: `Husket svar: ${question.slice(0, 50)}`, confidence: match.exact ? 1 : 0.6, status: kind };
}
