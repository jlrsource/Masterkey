import type { ProfileDocument } from "./schema";

export type DocLanguage = "en" | "no";

// Filnavnet deles i ord («Karakterutskrift_EN.pdf» → «karakterutskrift», «en»).
// Språkmerker («engelsk», «EN») veier tyngre enn hva dokumentet heter («karakterutskrift»),
// så «Engelsk karakterutskrift» blir engelsk.
const MARKERS: [DocLanguage, RegExp][] = [
  ["en", /^(en|eng|english|engelsk|translated|translation)$/],
  ["no", /^(no|nb|nn|nor|norsk|norwegian|bokmål|nynorsk)$/],
];
const NAMES: [DocLanguage, RegExp][] = [
  ["en", /^(transcripts?|grades|diploma|records?|certificate|reference|recommendation)$/],
  ["no", /^(karakterutskrift|karakterkort|karakterar|karakterer|vitnemål|vitnemal|vitnemålet|utskrift|attest|attester|anbefaling)$/],
];

function match(words: string[], table: [DocLanguage, RegExp][]): DocLanguage | null {
  const hits = new Set(table.filter(([, re]) => words.some((w) => re.test(w))).map(([lang]) => lang));
  return hits.size === 1 ? [...hits][0]! : null;
}

/** Språket et dokument ser ut til å være på, ut fra filnavnet. Null hvis det ikke går an å si. */
export function documentLanguage(fileName: string): DocLanguage | null {
  const words = fileName
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return match(words, MARKERS) ?? match(words, NAMES);
}

/**
 * Dokumentet av en gitt type som passer best til språket på siden:
 * samme språk først, så standarddokumentet, så det første.
 */
export function pickDocument(docs: ProfileDocument[], type: ProfileDocument["type"], lang: DocLanguage | null = null): ProfileDocument | undefined {
  const ofType = docs.filter((d) => d.type === type);
  if (lang) {
    const same = ofType.filter((d) => documentLanguage(d.file_name) === lang);
    if (same.length) return same.find((d) => d.is_default) ?? same[0];
  }
  return ofType.find((d) => d.is_default) ?? ofType[0];
}
