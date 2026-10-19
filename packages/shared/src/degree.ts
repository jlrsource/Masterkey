/**
 * Utdanningsnivå. Brukes for å velge riktig alternativ i nedtrekkslister for grad,
 * der profilen kan si «Master i informatikk» og skjemaet «Master's Degree» eller «Graduate».
 */
export type DegreeLevel = "highschool" | "vocational" | "oneyear" | "bachelor" | "master" | "phd";

// Rekkefølgen betyr noe: «Bachelor of Science» skal ikke treffe master-mønsteret osv.
const LEVEL_PATTERNS: [DegreeLevel, RegExp][] = [
  // Ikke «doctor» alene: «Juris Doctor (JD)» er en jusgrad, ikke doktorgrad.
  ["phd", /\bph\.?\s?d\b|doktorgrad|doctorate|doctor of philosophy|\bdphil\b/],
  ["master", /master|\bm\.?\s?sc\b|\bmba\b|\bm\.?a\.?\b|siviling|hovedfag|cand\.?\s?(scient|polit|philol|oecon|jur|psychol|med)|graduate degree|postgraduate/],
  ["bachelor", /bachelor|\bb\.?\s?sc\b|\bb\.?a\.?\b|undergraduate|cand\.?\s?mag|høgskolekandidat|associate/],
  ["oneyear", /årsstudium|årsenhet|one.?year|1.?year/],
  ["vocational", /fagbrev|svennebrev|fagskole|vocational|trade school|technical college|yrkesfag/],
  ["highschool", /videregående|vgs|high school|secondary|gymnas|studiespesialiserende|a.?levels|diploma of upper/],
];

export function degreeLevel(text: string | null | undefined): DegreeLevel | null {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  return LEVEL_PATTERNS.find(([, re]) => re.test(t))?.[0] ?? null;
}

export const DEGREE_LEVEL_NAMES: Record<DegreeLevel, string> = {
  highschool: "Videregående",
  vocational: "Fagbrev",
  oneyear: "Årsstudium",
  bachelor: "Bachelor",
  master: "Master",
  phd: "Doktorgrad",
};

const PLACEHOLDER = /^(select|velg|choose|vel|--|none|ingen)\b/i;

type Field = "science" | "arts" | "business";

/** Fagretning ut fra grad, fagfelt og skole. Brukes til å velge mellom «Master of Science» og «Master of Arts». */
const FIELD_PATTERNS: [Field, RegExp][] = [
  ["business", /økonomi|administrasjon|business|finans|regnskap|revisjon|markedsføring|ledelse|siviløkonom|commerce|management|accounting|\bmba\b/],
  [
    "science",
    /integrert|sivilingeniør|siv\.?\s?ing|ingeniør|teknologi|informatikk|\bdata|matematikk|fysikk|kjemi|biologi|geologi|statistikk|realfag|medisin|farmasi|engineering|computer|science|technology|\bntnu\b/,
  ],
  [
    "arts",
    /historie|språk|litteratur|filosofi|pedagogikk|kunst|musikk|medie|journalistikk|sosiologi|statsvitenskap|antropologi|religion|kultur|humaniora|samfunnsfag|arts|humanities|design/,
  ],
];

const OPTION_FIELD: Record<Field, RegExp> = {
  science: /science|\bm\.?\s?s\.?c?\b|\bb\.?\s?s\.?c?\b|engineering|technology/,
  arts: /\barts?\b|\bm\.?\s?a\.?\b|\bb\.?\s?a\.?\b/,
  business: /business|commerce|\bbcom\b|\bbbus\b|economics/,
};

export function degreeField(text: string | null | undefined): Field | null {
  const t = (text ?? "").toLowerCase();
  return FIELD_PATTERNS.find(([, re]) => re.test(t))?.[0] ?? null;
}

/**
 * Velg alternativet med samme nivå som verdien. `context` (fagfelt, skole …) avgjør
 * fagretningen blant flere med samme nivå: «Integrert master» + informatikk → «Master of Science».
 * MBA velges bare når profilen sier MBA. Ellers vinner det korteste. -1 hvis ingen passer.
 */
export function bestDegreeOptionIndex(options: string[], value: string, context = ""): number {
  const level = degreeLevel(value) ?? degreeLevel(context);
  if (!level) return -1;
  const all = `${value} ${context}`.toLowerCase();
  const field = degreeField(all);
  const wantsMba = /\bmba\b|business administration/.test(all);

  let best = -1;
  let bestScore = -Infinity;
  options.forEach((o, i) => {
    const t = o.toLowerCase();
    if (PLACEHOLDER.test(o.trim()) || degreeLevel(o) !== level) return;
    let score = -o.length / 100; // kortere alternativ vinner ved likhet
    if (field && OPTION_FIELD[field].test(t)) score += 10;
    if (field === "business" && /business/.test(t)) score += 1; // «Business» foran «Commerce»
    // Siviløkonom/master i økonomi er en Master of Science, ikke MBA.
    if (field === "business" && level === "master" && !wantsMba && OPTION_FIELD.science.test(t)) score += 9;
    if (/\bmba\b|business administration/.test(t) && !wantsMba) score -= 20;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}
