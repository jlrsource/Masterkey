import type { CvExtraction } from "./cvExtraction";
import type { Certification, Education, Experience, FullProfile, Language, Personal, Skill, Volunteering } from "./schema";

/** Seksjonene en CV-import kan legge til rader i. */
export const IMPORT_SECTIONS = ["experiences", "volunteering", "educations", "certifications", "skills", "languages"] as const;
export type ImportSection = (typeof IMPORT_SECTIONS)[number];

type NewRow<T> = Omit<T, "id" | "sort_order"> & { sort_order: number };
export interface ImportRows {
  experiences: NewRow<Experience>;
  volunteering: NewRow<Volunteering>;
  educations: NewRow<Education>;
  certifications: NewRow<Certification>;
  skills: NewRow<Skill>;
  languages: NewRow<Language>;
}

export interface PersonalSuggestion {
  key: keyof Personal;
  label: string;
  current: string | null;
  proposed: string;
  /** Forhåndsvalgt bare når feltet er tomt i profilen, så vi aldri overskriver uten at brukeren ber om det. */
  selected: boolean;
}

export interface RowSuggestion<S extends ImportSection> {
  row: ImportRows[S];
  /** Finnes allerede i profilen. Ikke forhåndsvalgt. */
  duplicate: boolean;
  selected: boolean;
}

export interface CvProposal {
  personal: PersonalSuggestion[];
  lists: { [S in ImportSection]: RowSuggestion<S>[] };
}

/** Personalia fra CV-en (de faste søknadssvarene står ikke i en CV). */
type CvPersonalKey = Exclude<keyof Personal, "application_prefs">;

export const PERSONAL_LABELS: Record<CvPersonalKey, string> = {
  first_name: "Fornavn",
  last_name: "Etternavn",
  email: "E-post",
  phone: "Telefon",
  address: "Adresse",
  postal_code: "Postnummer",
  city: "Poststed",
  country: "Land",
  birth_date: "Fødselsdato",
  linkedin_url: "LinkedIn",
  website_url: "Nettside",
  github_url: "GitHub",
  headline: "Profesjonell tittel",
  summary: "Sammendrag",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Godtar bare gyldige ISO-datoer. Alt annet blir null, så databasen ikke avviser raden. */
export function cleanDate(v: string | null | undefined): string | null {
  if (!v || !ISO_DATE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** "unknown" og tomme verdier fra CV-uttrekket blir null. */
const cleanLevel = <T extends string>(v: T | "unknown" | null | undefined): T | null => (v && v !== "unknown" ? (v as T) : null);

/** Trimmer og gjør tom tekst om til null, uten å endre innholdet. Brukes for URL-er og e-post. */
const cleanRaw = (v: string | null | undefined) => {
  const t = v?.trim();
  return t ? t : null;
};

/** Som cleanRaw, men erstatter semikolon med komma i fritekst: «A; B» blir «A, B». */
const cleanText = (v: string | null | undefined) => cleanRaw(v?.replace(/\s*;\s*/g, ", ").replace(/,\s*$/, ""));

/** Felt som skal lagres akkurat som de står. */
const RAW_PERSONAL_FIELDS = new Set<keyof Personal>(["email", "linkedin_url", "website_url", "github_url"]);

const key = (...parts: (string | null | undefined)[]) =>
  parts
    .map((p) => (p ?? "").toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim())
    .join("|");

/** Nøkkel som avgjør om to rader er «den samme». */
const ROW_KEY: { [S in ImportSection]: (r: ImportRows[S]) => string } = {
  experiences: (r) => key(r.employer, r.title),
  volunteering: (r) => key(r.organization, r.role),
  educations: (r) => key(r.school, r.degree ?? r.field_of_study),
  certifications: (r) => key(r.name),
  skills: (r) => key(r.name),
  languages: (r) => key(r.language),
};

function normalizeRows(x: CvExtraction): { [S in ImportSection]: ImportRows[S][] } {
  return {
    experiences: x.experiences.map((e, i) => ({
      title: e.title.trim(),
      employer: e.employer.trim(),
      location: cleanText(e.location),
      start_date: cleanDate(e.start_date),
      end_date: e.is_current ? null : cleanDate(e.end_date),
      is_current: e.is_current,
      employment_percentage: e.employment_percentage >= 1 && e.employment_percentage <= 100 ? Math.round(e.employment_percentage) : null,
      description: cleanText(e.description),
      sort_order: i,
    })),
    volunteering: x.volunteering.map((v, i) => ({
      role: v.role.trim(),
      organization: v.organization.trim(),
      location: cleanText(v.location),
      start_date: cleanDate(v.start_date),
      end_date: v.is_current ? null : cleanDate(v.end_date),
      is_current: v.is_current,
      description: cleanText(v.description),
      sort_order: i,
    })),
    educations: x.educations.map((e, i) => ({
      school: e.school.trim(),
      degree: cleanText(e.degree),
      field_of_study: cleanText(e.field_of_study),
      location: cleanText(e.location),
      start_date: cleanDate(e.start_date),
      end_date: cleanDate(e.end_date),
      grade: cleanText(e.grade),
      description: cleanText(e.description),
      sort_order: i,
    })),
    certifications: x.certifications.map((c, i) => ({
      name: c.name.trim(),
      issuer: cleanText(c.issuer),
      issued_date: cleanDate(c.issued_date),
      url: cleanRaw(c.url),
      sort_order: i,
    })),
    skills: x.skills.map((s, i) => ({ name: s.name.trim(), level: cleanLevel(s.level), sort_order: i })),
    languages: x.languages.map((l, i) => ({
      language: l.language.trim(),
      spoken_level: cleanLevel(l.spoken_level),
      written_level: cleanLevel(l.written_level),
      sort_order: i,
    })),
  };
}

function suggestRows<S extends ImportSection>(section: S, rows: ImportRows[S][], existing: ImportRows[S][]): RowSuggestion<S>[] {
  const toKey = ROW_KEY[section] as (r: ImportRows[S]) => string;
  const existingKeys = new Set(existing.map(toKey));
  const seen = new Set<string>();
  const out: RowSuggestion<S>[] = [];
  for (const row of rows) {
    const k = toKey(row);
    if (!k.replace(/\|/g, "") || seen.has(k)) continue; // tomme rader og duplikater i selve CV-en
    seen.add(k);
    const duplicate = existingKeys.has(k);
    out.push({ row, duplicate, selected: !duplicate });
  }
  return out;
}

/** Sammenligner det Claude fant i CV-en med profilen og lager forslag brukeren kan godkjenne. */
export function buildCvProposal(extraction: CvExtraction, profile: FullProfile): CvProposal {
  const current = profile.personal ?? {};
  const personal: PersonalSuggestion[] = [];
  for (const k of Object.keys(PERSONAL_LABELS) as CvPersonalKey[]) {
    const raw = extraction.personal[k as keyof CvExtraction["personal"]];
    const proposed = k === "birth_date" ? cleanDate(raw) : RAW_PERSONAL_FIELDS.has(k) ? cleanRaw(raw) : cleanText(raw);
    if (!proposed) continue;
    const cur = cleanText(current[k]);
    if (cur && key(cur) === key(proposed)) continue; // allerede likt
    personal.push({ key: k, label: PERSONAL_LABELS[k], current: cur, proposed, selected: !cur });
  }

  const rows = normalizeRows(extraction);
  return {
    personal,
    lists: {
      experiences: suggestRows("experiences", rows.experiences, profile.experiences as ImportRows["experiences"][]),
      volunteering: suggestRows("volunteering", rows.volunteering, profile.volunteering as ImportRows["volunteering"][]),
      educations: suggestRows("educations", rows.educations, profile.educations as ImportRows["educations"][]),
      certifications: suggestRows("certifications", rows.certifications, profile.certifications as ImportRows["certifications"][]),
      skills: suggestRows("skills", rows.skills, profile.skills as ImportRows["skills"][]),
      languages: suggestRows("languages", rows.languages, profile.languages as ImportRows["languages"][]),
    },
  };
}

export function countSelected(p: CvProposal): number {
  return p.personal.filter((s) => s.selected).length + IMPORT_SECTIONS.reduce((n, s) => n + p.lists[s].filter((r) => r.selected).length, 0);
}
