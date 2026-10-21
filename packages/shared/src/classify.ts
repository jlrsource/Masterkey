import { AUTOCOMPLETE_MAP, KEYWORDS, NEGATIVE_KEYWORDS } from "./fieldDictionary";
import { FIELD_KEYS, type FieldKey } from "./fields";

/** Alt vi vet om et skjemafelt, hentet fra DOM-en av content scriptet. */
export interface FieldDescriptor {
  tag: "input" | "textarea" | "select" | "contenteditable";
  type?: string;
  autocomplete?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  label?: string;
  ariaLabel?: string;
  nearbyText?: string;
}

export interface Classification {
  key: FieldKey;
  /** 0–1. Over HIGH_CONFIDENCE regnes som sikkert treff. */
  confidence: number;
}

export const MIN_CONFIDENCE = 0.5;
export const HIGH_CONFIDENCE = 0.75;

const FILE_KEYS: FieldKey[] = ["cvFile", "coverLetterFile", "diplomaFile"];
const LONG_TEXT_KEYS: FieldKey[] = ["summary", "motivation"];

export function normalize(text: string | undefined | null): string {
  if (!text) return "";
  return text
    .replace(/([a-zæøå])([A-ZÆØÅ])/g, "$1 $2") // camelCase → camel Case
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, (m, offset, str) => {
      // Behold å (a + ring) – fjern andre diakritiske tegn (é → e).
      return m === "̊" && str[offset - 1] === "a" ? m : "";
    })
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRegex = (kw: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(normalize(kw))}(?:$|[^\\p{L}\\p{N}])`, "u");

const compiled = FIELD_KEYS.map((key) => ({
  key,
  positives: KEYWORDS[key].map((kw) => ({ re: wordRegex(kw), specificity: Math.min(1, normalize(kw).length / 10) })),
  negatives: (NEGATIVE_KEYWORDS[key] ?? []).map(wordRegex),
}));

const SOURCE_WEIGHTS = {
  label: 1,
  ariaLabel: 1,
  placeholder: 0.85,
  name: 0.8,
  id: 0.75,
  nearbyText: 0.6,
} as const;
type Source = keyof typeof SOURCE_WEIGHTS;

export function classifyField(d: FieldDescriptor): Classification | null {
  const type = (d.type ?? "").toLowerCase();
  if (["hidden", "submit", "button", "reset", "image", "password", "checkbox", "radio", "search", "range", "color"].includes(type)) return null;

  // 1. autocomplete-attributtet er det sikreste signalet.
  const ac = (d.autocomplete ?? "").toLowerCase().split(/\s+/).find((t) => t in AUTOCOMPLETE_MAP);
  if (ac) return { key: AUTOCOMPLETE_MAP[ac]!, confidence: 1 };

  const isFile = type === "file";
  const texts: Record<Source, string> = {
    label: normalize(d.label),
    ariaLabel: normalize(d.ariaLabel),
    placeholder: normalize(d.placeholder),
    name: normalize(d.name),
    id: normalize(d.id),
    nearbyText: normalize(d.nearbyText),
  };
  // Negative ord sjekkes bare mot feltets egne tekster, ikke nærliggende tekst.
  const ownText = [texts.label, texts.ariaLabel, texts.placeholder, texts.name, texts.id].join(" | ");

  let best: Classification | null = null;
  for (const { key, positives, negatives } of compiled) {
    if (isFile !== FILE_KEYS.includes(key)) continue;
    if (negatives.some((re) => re.test(ownText))) continue;

    let top = 0;
    let sourcesHit = 0;
    for (const source of Object.keys(SOURCE_WEIGHTS) as Source[]) {
      const text = texts[source];
      if (!text) continue;
      let sourceBest = 0;
      for (const p of positives) {
        if (p.re.test(text)) sourceBest = Math.max(sourceBest, SOURCE_WEIGHTS[source] * (0.75 + 0.25 * p.specificity));
      }
      if (sourceBest > 0) {
        sourcesHit++;
        top = Math.max(top, sourceBest);
      }
    }
    if (top === 0) continue;

    let score = top + Math.min(0.1, (sourcesHit - 1) * 0.05);
    if (key === "email" && type === "email") score += 0.2;
    if (key === "phone" && type === "tel") score += 0.2;
    if (LONG_TEXT_KEYS.includes(key) && d.tag !== "textarea" && d.tag !== "contenteditable") score -= 0.15;
    score = Math.min(1, score);

    if (!best || score > best.confidence) best = { key, confidence: score };
  }

  // Typen alene er nok når teksten ikke sier noe.
  if (!best && type === "email") best = { key: "email", confidence: 0.8 };
  if (!best && type === "tel") best = { key: "phone", confidence: 0.8 };
  // Filfelt uten gjenkjennelig tekst gjetter vi ikke på her. Motoren gir CV-en til
  // et slikt felt bare hvis det er det eneste filfeltet på siden.

  return best && best.confidence >= MIN_CONFIDENCE ? best : null;
}
