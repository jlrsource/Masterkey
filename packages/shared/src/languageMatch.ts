import type { Language } from "./schema";

/** Norske språknavn → engelske, siden mange skjemaer (bl.a. Workday) bare har engelske navn. */
const LANGUAGE_NAMES: Record<string, string[]> = {
  norsk: ["norwegian", "norsk", "bokmål", "nynorsk"],
  engelsk: ["english"],
  svensk: ["swedish"],
  dansk: ["danish"],
  tysk: ["german", "deutsch"],
  fransk: ["french", "français"],
  spansk: ["spanish", "español"],
  italiensk: ["italian"],
  portugisisk: ["portuguese"],
  nederlandsk: ["dutch"],
  finsk: ["finnish"],
  islandsk: ["icelandic"],
  samisk: ["sami", "saami"],
  russisk: ["russian"],
  ukrainsk: ["ukrainian"],
  polsk: ["polish"],
  litauisk: ["lithuanian"],
  gresk: ["greek"],
  tyrkisk: ["turkish"],
  arabisk: ["arabic"],
  persisk: ["persian", "farsi"],
  urdu: ["urdu"],
  hindi: ["hindi"],
  somali: ["somali"],
  tigrinja: ["tigrinya"],
  kinesisk: ["chinese", "mandarin"],
  mandarin: ["mandarin", "chinese"],
  japansk: ["japanese"],
  koreansk: ["korean"],
  vietnamesisk: ["vietnamese"],
  thai: ["thai"],
};

const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\s]+/gu, " ").replace(/\s+/g, " ").trim();

/** Velg alternativet som er samme språk som `language` (norsk eller engelsk navn). -1 hvis ingen. */
export function languageOptionIndex(options: string[], language: string): number {
  const name = clean(language);
  const names = [name, ...(LANGUAGE_NAMES[name] ?? [])];
  let best = -1;
  options.forEach((o, i) => {
    const t = clean(o);
    // «Norwegian (Bokmål)» og «English (US)» skal også treffe; kortest vinner.
    if (names.some((n) => t === n || t.startsWith(`${n} `)) && (best < 0 || o.length < options[best]!.length)) best = i;
  });
  return best;
}

export type LanguageLevel = NonNullable<Language["spoken_level"]>;
const ORDER: LanguageLevel[] = ["basic", "conversational", "fluent", "native"];

/** Ord som betyr akkurat dette nivået. Vinner over synonymene i LEVEL_WORDS («Fluent» foran «Advanced»). */
const EXACT_WORDS: Record<LanguageLevel, RegExp> = {
  native: /native|morsmål|mother tongue/,
  fluent: /fluent|flytende|full professional/,
  conversational: /conversational|professional working|\bgood\b|\bgodt?\b|\bgode\b/,
  basic: /basic|grunnleggende|elementary/,
};

/** Nøkkelord per nivå, sterkest først. Dekker vanlige engelske og norske skalaer. */
const LEVEL_WORDS: Record<LanguageLevel, RegExp> = {
  native: /native|mother tongue|morsmål|bilingual|tospråklig/,
  fluent: /fluent|flytende|full professional|proficient|advanced|avansert|expert|c1|c2/,
  conversational: /intermediate|conversational|working|professional|good|godt?\b|gode|middels|b1|b2/,
  basic: /basic|beginner|elementary|limited|grunnleggende|nybegynner|a1|a2/,
};

/** Høyeste av muntlig og skriftlig nivå («Overall»). */
export function overallLanguageLevel(l: Pick<Language, "spoken_level" | "written_level">): LanguageLevel | null {
  const levels = [l.spoken_level, l.written_level].filter((x): x is LanguageLevel => Boolean(x));
  return levels.sort((a, b) => ORDER.indexOf(b) - ORDER.indexOf(a))[0] ?? null;
}

/**
 * Velg alternativet som passer best med nivået. Finnes ikke nivået i listen, velges nærmeste
 * nivå under (aldri over, så vi ikke overdriver). -1 hvis ingen passer.
 */
export function languageLevelOptionIndex(options: string[], level: LanguageLevel): number {
  const levelOf = (o: string): LanguageLevel | null => {
    const t = o.toLowerCase();
    if (/^(select|velg|choose)\b/.test(t.trim())) return null;
    // «Limited working» er grunnleggende, ikke «working».
    if (/limited/.test(t)) return "basic";
    return ORDER.slice().reverse().find((l) => LEVEL_WORDS[l].test(t)) ?? null;
  };
  for (let target = ORDER.indexOf(level); target >= 0; target--) {
    const lvl = ORDER[target]!;
    const candidates = options.map((o, i) => ({ o, i })).filter(({ o }) => levelOf(o) === lvl);
    const exact = candidates.find(({ o }) => EXACT_WORDS[lvl].test(o.toLowerCase()));
    const pick = exact ?? candidates[0];
    if (pick) return pick.i;
  }
  return -1;
}
