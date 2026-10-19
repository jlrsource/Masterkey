import { z } from "zod";

// Feltnavn følger databasekolonnene (snake_case), så rader kan brukes direkte uten mapping.

const optionalText = z.string().trim().nullish();
const optionalDate = z.string().nullish(); // ISO yyyy-mm-dd

export const personalSchema = z.object({
  first_name: optionalText,
  last_name: optionalText,
  email: z.email().nullish().or(z.literal("")),
  phone: optionalText,
  address: optionalText,
  postal_code: optionalText,
  city: optionalText,
  country: optionalText,
  birth_date: optionalDate,
  linkedin_url: optionalText,
  website_url: optionalText,
  github_url: optionalText,
  headline: optionalText,
  summary: optionalText,
});
export type Personal = z.infer<typeof personalSchema>;

const rowBase = { id: z.uuid().optional(), sort_order: z.number().int().default(0) };

export const experienceSchema = z.object({
  ...rowBase,
  employer: z.string().trim().min(1, "Arbeidsgiver må fylles ut"),
  title: z.string().trim().min(1, "Stillingstittel må fylles ut"),
  location: optionalText,
  start_date: optionalDate,
  end_date: optionalDate,
  is_current: z.boolean().default(false),
  description: optionalText,
});
export type Experience = z.infer<typeof experienceSchema>;

export const volunteeringSchema = z.object({
  ...rowBase,
  organization: z.string().trim().min(1, "Organisasjon må fylles ut"),
  role: z.string().trim().min(1, "Rolle må fylles ut"),
  location: optionalText,
  start_date: optionalDate,
  end_date: optionalDate,
  is_current: z.boolean().default(false),
  description: optionalText,
});
export type Volunteering = z.infer<typeof volunteeringSchema>;

export const educationSchema = z.object({
  ...rowBase,
  school: z.string().trim().min(1, "Skole må fylles ut"),
  degree: optionalText,
  field_of_study: optionalText,
  /** Engelske søkeord for fagfeltet, laget av AI. Mest presist først. */
  field_of_study_en: z.array(z.string()).nullish(),
  field_of_study_en_source: optionalText,
  location: optionalText,
  start_date: optionalDate,
  end_date: optionalDate,
  grade: optionalText,
  description: optionalText,
});
export type Education = z.infer<typeof educationSchema>;

export const certificationSchema = z.object({
  ...rowBase,
  name: z.string().trim().min(1, "Navn må fylles ut"),
  issuer: optionalText,
  issued_date: optionalDate,
  url: optionalText,
});
export type Certification = z.infer<typeof certificationSchema>;

export const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "expert"] as const;
export const skillSchema = z.object({
  ...rowBase,
  name: z.string().trim().min(1, "Navn må fylles ut"),
  level: z.enum(SKILL_LEVELS).nullish(),
});
export type Skill = z.infer<typeof skillSchema>;

export const LANGUAGE_LEVELS = ["basic", "conversational", "fluent", "native"] as const;
export const languageSchema = z.object({
  ...rowBase,
  language: z.string().trim().min(1, "Språk må fylles ut"),
  spoken_level: z.enum(LANGUAGE_LEVELS).nullish(),
  written_level: z.enum(LANGUAGE_LEVELS).nullish(),
});
export type Language = z.infer<typeof languageSchema>;

export const referenceSchema = z.object({
  ...rowBase,
  name: z.string().trim().min(1, "Navn må fylles ut"),
  role: optionalText,
  company: optionalText,
  phone: optionalText,
  email: optionalText,
  relation: optionalText,
});
export type Reference = z.infer<typeof referenceSchema>;

export const savedAnswerSchema = z.object({
  id: z.uuid().optional(),
  question: z.string().trim().min(1, "Spørsmål må fylles ut"),
  answer: z.string().trim().min(1, "Svar må fylles ut"),
  tags: z.array(z.string()).default([]),
});
export type SavedAnswer = z.infer<typeof savedAnswerSchema>;

export const DOCUMENT_TYPES = ["cv", "cover_letter", "diploma", "other"] as const;
export const documentSchema = z.object({
  id: z.uuid().optional(),
  type: z.enum(DOCUMENT_TYPES),
  file_name: z.string(),
  storage_path: z.string(),
  mime_type: optionalText,
  size_bytes: z.number().nullish(),
  is_default: z.boolean().default(false),
  created_at: z.string().optional(),
});
export type ProfileDocument = z.infer<typeof documentSchema>;

/** Hele profilen slik `get_full_profile()` returnerer den. */
export const fullProfileSchema = z.object({
  personal: personalSchema.nullable(),
  experiences: z.array(experienceSchema),
  // default([]) så profilen fortsatt kan leses før verv-migrasjonen er kjørt
  volunteering: z.array(volunteeringSchema).default([]),
  educations: z.array(educationSchema),
  certifications: z.array(certificationSchema),
  skills: z.array(skillSchema),
  languages: z.array(languageSchema),
  references: z.array(referenceSchema),
  saved_answers: z.array(savedAnswerSchema),
  documents: z.array(documentSchema),
});
export type FullProfile = z.infer<typeof fullProfileSchema>;

export const emptyProfile = (): FullProfile => ({
  personal: null,
  experiences: [],
  volunteering: [],
  educations: [],
  certifications: [],
  skills: [],
  languages: [],
  references: [],
  saved_answers: [],
  documents: [],
});

export const SKILL_LEVEL_LABELS: Record<(typeof SKILL_LEVELS)[number], string> = {
  beginner: "Nybegynner",
  intermediate: "Middels",
  advanced: "Avansert",
  expert: "Ekspert",
};

export const LANGUAGE_LEVEL_LABELS: Record<(typeof LANGUAGE_LEVELS)[number], string> = {
  basic: "Grunnleggende",
  conversational: "Godt",
  fluent: "Flytende",
  native: "Morsmål",
};

export const DOCUMENT_TYPE_LABELS: Record<(typeof DOCUMENT_TYPES)[number], string> = {
  cv: "CV",
  cover_letter: "Søknadsbrev",
  diploma: "Vitnemål / attest",
  other: "Annet",
};
