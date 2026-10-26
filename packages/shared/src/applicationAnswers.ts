import { normalize } from "./classify";
import { LANGUAGE_LEVEL_ORDER, languagesIn, overallLanguageLevel, sameLanguage } from "./languageMatch";
import type { FieldKey } from "./fields";
import type { ApplicationPrefs, FullProfile, SavedAnswer } from "./schema";

/**
 * Faste søknadssvar (profilens «Søknadssvar») og husket svar fra tidligere søknader.
 * Avkrysningsspørsmål besvares bare når brukeren har gitt et svar. Samtykker krysses aldri av.
 */

/** Samtykker og erklæringer: brukeren må alltid krysse av selv. */
export const CONSENT_RE =
  /\b(i agree|agree to|i accept|consent|i certify|certify that|i confirm|i acknowledge|acknowledge that|privacy (policy|notice)|terms (and|&) conditions|samtykk\w*|godtar|aksepterer|jeg bekrefter|bekrefter at|personvern\w*|vilkår\w*)\b/i;

export function isConsentQuestion(text: string): boolean {
  return CONSENT_RE.test(text);
}

/** Spørsmål der svaret er et valg (Ja/Nei, arbeidsform …), ikke fritekst. */
export const PREF_CHOICE_KEYS: FieldKey[] = [
  "workAuthorization", "needsSponsorship", "relocate", "workMode", "employmentType", "driversLicense", "pronouns", "gender",
  "languageProficiency", "previousEmployer", "restrictiveAgreement",
];

/** Svar som avhenger av selve spørsmålet (landet, språket, firmaet eller arbeidsformen det spør om). */
export const QUESTION_DEPENDENT_KEYS: FieldKey[] = ["workAuthorization", "languageProficiency", "previousEmployer", "workMode"];

const YES = /^(yes|ja|y)\b/;
const NO = /^(no|nei|n)\b/;

const REGION_WORDS: Record<NonNullable<ApplicationPrefs["work_auth"]>[number], RegExp> = {
  norway: /norway|norge|noreg|norwegian|norsk/,
  eu_eea: /\beu\b|\beea\b|eøs|european union|european economic|\beurope/,
  uk: /united kingdom|\buk\b|britain|england/,
  us: /united states|\busa?\b|\bu s\b|america/,
};

const OPTION_WORDS: Record<string, Record<string, RegExp>> = {
  workMode: { onsite: /on ?site|in (the )?office|kontor|på stedet|fysisk/, hybrid: /hybrid/, remote: /remote|hjemmekontor|fjern|work from home/ },
  employmentType: { fulltime: /full|heltid|100/, parttime: /part|deltid/ },
  pronouns: { he: /\b(he|him|han|ham)\b/, she: /\b(she|her|hun|henne)\b/, they: /\b(they|them|hen)\b/ },
  heardAbout: {
    linkedin: /linkedin/,
    finn: /\bfinn\b/,
    nav: /\bnav\b/,
    company_website: /website|careers? (page|site)|company (site|page)|nettside|karriereside|hjemmeside/,
    university: /universit|college|career fair|campus|student|karrieredag|karrieremesse|bedriftspresentasjon|school/,
    referral: /referr|referred|employee|friend|colleague|ansatt|venn|kollega|anbefal/,
    social_media: /social media|facebook|instagram|twitter|tiktok|sosiale medier/,
    job_board: /job board|indeed|glassdoor|jobbportal|stillingsportal|wellfound|monster/,
    recruiter: /recruiter|headhunter|rekrutter|search firm|agency/,
    event: /event|conference|konferanse|arrangement|meetup/,
    other: /^(other|annet|andre)\b/,
  },
  gender: {
    man: /\b(man|male|mann)\b/,
    woman: /\b(woman|female|kvinne)\b/,
    nonbinary: /non ?binary|ikke ?binær/,
    undisclosed: /prefer not|do not wish|don t wish|decline|ønsker ikke|vil ikke oppgi|not to (say|disclose|answer)/,
  },
};

/** Arbeidsformen et Ja/Nei-spørsmål handler om («hybrid schedule», «fully remote», «on-site»). */
function askedWorkMode(q: string): (typeof WORK_MODE_KEYS)[number] | null {
  if (/hybrid/.test(q)) return "hybrid";
  if (/remote|hjemmekontor|work from home|fjernarbeid/.test(q)) return "remote";
  if (/on ?site|in (the )?office|at the office|på kontoret|i kontorlokal/.test(q)) return "onsite";
  return null;
}
const WORK_MODE_KEYS = ["onsite", "hybrid", "remote"] as const;
/** Hvilke arbeidsformer brukeren sier ja til, ut fra den de foretrekker. */
const WORK_MODE_YES: Record<(typeof WORK_MODE_KEYS)[number], string[]> = {
  onsite: ["onsite", "hybrid"],
  hybrid: ["hybrid", "onsite", "remote"],
  remote: ["remote", "hybrid"],
};

const DISPLAY: Record<string, Record<string, string>> = {
  yesNo: { yes: "Ja", no: "Nei" },
  workMode: { onsite: "På kontoret", hybrid: "Hybrid", remote: "Hjemmekontor" },
  employmentType: { fulltime: "Heltid", parttime: "Deltid" },
  pronouns: { he: "Han/ham", she: "Hun/henne", they: "Hen" },
  heardAbout: {
    linkedin: "LinkedIn", finn: "Finn.no", nav: "NAV", company_website: "Bedriftens nettside", university: "Universitet/karrieredag",
    referral: "Tips fra en ansatt eller bekjent", social_media: "Sosiale medier", job_board: "Annen jobbportal", recruiter: "Rekrutterer/headhunter",
    event: "Arrangement/konferanse", other: "Annet",
  },
  gender: { man: "Mann", woman: "Kvinne", nonbinary: "Ikke-binær", undisclosed: "Ønsker ikke å oppgi" },
};

function prefs(p: FullProfile): ApplicationPrefs {
  return p.personal?.application_prefs ?? {};
}

/**
 * Svaret på et søknadsspørsmål fra de faste svarene, som den lagrede verdien («yes», «remote» …),
 * eller null når brukeren ikke har svart. Arbeidstillatelse avhenger av landet i spørsmålet.
 * `sure` er false når svaret er en gjetning (spørsmålet nevner ikke noe land: vi antar Norge).
 */
export function prefAnswer(key: FieldKey, p: FullProfile, question = ""): { value: string; sure: boolean; yesNo?: boolean } | null {
  const a = prefs(p);
  switch (key) {
    case "workAuthorization": {
      if (!a.work_auth?.length) return null;
      const q = normalize(question);
      const region = (Object.keys(REGION_WORDS) as (keyof typeof REGION_WORDS)[]).find((r) => REGION_WORDS[r].test(q));
      return { value: a.work_auth.includes(region ?? "norway") ? "yes" : "no", sure: Boolean(region) };
    }
    case "needsSponsorship": return a.needs_sponsorship ? { value: a.needs_sponsorship, sure: true } : null;
    case "relocate": return a.relocate ? { value: a.relocate, sure: true } : null;
    case "workMode": {
      if (!a.work_mode) return null;
      // «I am willing to work a hybrid schedule» (Ja/Nei): svaret avhenger av hvilken arbeidsform spørsmålet nevner.
      const asked = askedWorkMode(normalize(question));
      if (!asked || !question) return { value: a.work_mode, sure: true };
      return { value: WORK_MODE_YES[a.work_mode].includes(asked) ? "yes" : "no", sure: asked === a.work_mode, yesNo: true };
    }
    case "languageProficiency": {
      const asked = languagesIn(question);
      if (!asked.length || !p.languages?.length) return null;
      // «Full work proficiency» krever flytende/morsmål; ellers holder «godt».
      const need = /full|fluent|flytende|native|morsmål|professional/.test(normalize(question)) ? "fluent" : "conversational";
      const has = asked.every((lang) => {
        const entry = p.languages.find((l) => sameLanguage(l.language, lang));
        const level = entry ? overallLanguageLevel(entry) : null;
        return level !== null && LANGUAGE_LEVEL_ORDER.indexOf(level) >= LANGUAGE_LEVEL_ORDER.indexOf(need);
      });
      // Språk som ikke står i profilen kan likevel være noe brukeren kan: sjekk.
      return { value: has ? "yes" : "no", sure: has };
    }
    case "previousEmployer": {
      const companies = [...names(question)];
      if (!companies.length) return null;
      const job = p.experiences.find((e) => companies.some((c) => normalize(e.employer).includes(c)));
      // «current» når jobben pågår: noen skjemaer skiller «Current employee» og «Former employee».
      return { value: !job ? "no" : job.is_current ? "current" : "yes", sure: Boolean(job) };
    }
    case "employmentType": return a.employment_type ? { value: a.employment_type, sure: true } : null;
    case "driversLicense": return a.drivers_license ? { value: a.drivers_license, sure: true } : null;
    case "restrictiveAgreement": return a.restrictive_agreement ? { value: a.restrictive_agreement, sure: true } : null;
    case "pronouns": return a.pronouns ? { value: a.pronouns, sure: true } : null;
    case "gender": return a.gender ? { value: a.gender, sure: true } : null;
    case "noticePeriod": return a.notice_period?.trim() ? { value: a.notice_period.trim(), sure: true } : null;
    case "heardAbout":
      if (a.heard_about_source) return { value: a.heard_about_source, sure: true };
      return a.heard_about?.trim() ? { value: a.heard_about.trim(), sure: true } : null;
    case "availability": return a.earliest_start?.trim() ? { value: a.earliest_start.trim(), sure: true } : null;
    default: return null;
  }
}

/**
 * Avkrysningsliste med språk som alternativer («Do you have work proficiency in another Nordic
 * language? Danish / Finnish / Swedish / None of the above»): språkene brukeren kan, ellers «None».
 * Null hvis alternativene ikke er språk.
 */
export function languageOptionPicks(texts: string[], question: string, p: FullProfile): number[] | null {
  const langs = texts.map((t) => languagesIn(t));
  if (langs.filter((l) => l.length).length < 2) return null;
  const need = /full|fluent|flytende|native|morsmål|professional/.test(normalize(question)) ? "fluent" : "conversational";
  const knows = (lang: string) => {
    const entry = (p.languages ?? []).find((l) => sameLanguage(l.language, lang));
    const level = entry ? overallLanguageLevel(entry) : null;
    return level !== null && LANGUAGE_LEVEL_ORDER.indexOf(level) >= LANGUAGE_LEVEL_ORDER.indexOf(need);
  };
  const picks = langs.map((l, i) => (l.length && l.every(knows) ? i : -1)).filter((i) => i >= 0);
  if (picks.length) return picks;
  const none = texts.findIndex((t) => /none|ingen|not applicable|ikke aktuelt/.test(normalize(t)));
  return none >= 0 ? [none] : null;
}

/**
 * «Hvor hørte du om stillingen?» i en liste: kategorien, ellers «Other». `other` er true når «Other»
 * ble valgt fordi kategorien manglet, så utdypingen skal i «If you selected Other, please specify».
 */
export function heardAboutOptionIndex(texts: string[], source: string): { index: number; other: boolean } {
  const i = prefOptionIndex("heardAbout", texts, source);
  if (i >= 0) return { index: i, other: source === "other" };
  const other = prefOptionIndex("heardAbout", texts, "other");
  return { index: other, other: other >= 0 };
}

/** Utdypingen på sidens språk (engelsk når siden er engelsk og oversettelsen finnes). */
export function heardAboutDetail(p: FullProfile, lang: "en" | "no" | null): string | null {
  const a = prefs(p);
  const en = a.heard_about_en?.trim();
  const no = a.heard_about?.trim();
  return (lang === "en" ? en || no : no || en) || null;
}

/** Teksten som skrives i et vanlig tekstfelt («Ja», «Hybrid» …). */
export function prefDisplay(key: FieldKey, value: string): string {
  const group = value === "yes" || value === "no" ? "yesNo" : key;
  return DISPLAY[group]?.[value] ?? value;
}

/** Alternativet som passer svaret («Yes», «Hybrid», «He/him» …), eller -1. */
export function prefOptionIndex(key: FieldKey, texts: string[], value: string): number {
  const norm = texts.map((t) => normalize(t));
  if (key === "previousEmployer") {
    // «No previous work experience with the company» / «Former employee or intern» / «Current employee or intern».
    const re = value === "no" ? NO : YES;
    const direct = norm.findIndex((t) => re.test(t) || (value === "no" && /^(never|aldri|ingen)\b/.test(t)));
    if (direct >= 0) return direct;
    if (value === "no") return -1;
    const kind = value === "current" ? /\b(current|nåværende|currently)\b/ : /\b(former|previous|tidligere|ex)\b/;
    const employee = norm.findIndex((t) => kind.test(t) && /employee|ansatt|intern/.test(t));
    return employee >= 0 ? employee : norm.findIndex((t) => kind.test(t));
  }
  if (value === "yes" || value === "no") {
    const re = value === "yes" ? YES : NO;
    return norm.findIndex((t) => re.test(t));
  }
  const words = OPTION_WORDS[key]?.[value];
  if (words) return norm.findIndex((t) => words.test(t));
  // Fritekst («LinkedIn»): et alternativ som inneholder svaret, eller som svaret inneholder.
  const v = normalize(value);
  const i = norm.findIndex((t) => t && (t.includes(v) || v.includes(t)));
  return i;
}

// ---------------------------------------------------------------- husket svar

const words = (s: string) => new Set(normalize(s).split(" ").filter((w) => w.length >= 3));

/**
 * Navn i spørsmålet: ord med stor forbokstav som ikke starter en setning («KPMG», «Spotify»).
 * Navn på flere ord holdes samlet («Dun & Bradstreet» → «dun bradstreet»).
 */
export function names(s: string): Set<string> {
  const out = new Set<string>();
  const tokens = s.split(/\s+/);
  let current: string[] = [];
  const flush = () => {
    if (current.length) out.add(normalize(current.join(" ")));
    current = [];
  };
  tokens.forEach((t, i) => {
    const word = t.replace(/[^\p{L}\p{N}&]/gu, "");
    const startsSentence = i === 0 || /[.?!:]$/.test(tokens[i - 1] ?? "");
    const isName = word.length >= 2 && /^\p{Lu}/u.test(word) && !startsSentence && word !== "I";
    if (isName) current.push(word);
    else if (current.length && (word === "&" || word === "and" || word === "og")) current.push(word);
    else flush();
    if (/[,.?!:;]$/.test(t)) flush();
  });
  flush();
  return out;
}

/**
 * Et lagret svar på samme spørsmål. Likt spørsmål (uten tegnsetting/store bokstaver) er sikkert;
 * nesten likt (minst 85 % av ordene felles) gir et svar som bør sjekkes.
 */
export function findSavedAnswer(question: string, answers: SavedAnswer[]): { answer: SavedAnswer; exact: boolean } | null {
  const q = normalize(question);
  if (q.length < 4) return null;
  const exact = answers.find((a) => normalize(a.question) === q);
  if (exact) return { answer: exact, exact: true };
  const qw = words(question);
  if (qw.size < 3) return null;
  const qNames = names(question);
  let best: { answer: SavedAnswer; score: number } | null = null;
  for (const a of answers) {
    const aw = words(a.question);
    if (aw.size < 3) continue;
    // Ulike navn («KPMG» vs. «Deloitte») gjør spørsmålene ulike, selv om resten er likt.
    const aNames = names(a.question);
    if (qNames.size !== aNames.size || [...qNames].some((n) => !aNames.has(n))) continue;
    const common = [...qw].filter((w) => aw.has(w)).length;
    const score = common / new Set([...qw, ...aw]).size;
    if (score >= 0.85 && (!best || score > best.score)) best = { answer: a, score };
  }
  return best ? { answer: best.answer, exact: false } : null;
}

/** Tag på svar extensionen har husket fra en søknad. */
export const REMEMBERED_TAG = "husket";
