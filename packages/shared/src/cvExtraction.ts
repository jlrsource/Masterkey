import { LANGUAGE_LEVELS, SKILL_LEVELS } from "./schema";
import { z } from "zod";

/**
 * Det Claude skal trekke ut av en CV. Feltnavnene følger databasekolonnene.
 *
 * Ukjente verdier er tom streng ("") i stedet for null, og ukjent nivå er "unknown".
 * Nullable felt blir anyOf i JSON-skjemaet, og med mange av dem blir grammatikken
 * API-et kompilerer for structured outputs for stor ("compiled grammar is too large").
 * cvMerge.ts gjør tomme verdier om til null før noe lagres.
 */
const text = (description: string) => z.string().describe(`${description} Tom streng hvis ukjent.`);
const date = (description: string) =>
  z.string().describe(`${description} Format YYYY-MM-DD. Bruk 01 for ukjent dag og 01-01 for ukjent måned. Tom streng hvis ukjent.`);
const skillLevel = z.enum([...SKILL_LEVELS, "unknown"]);
const languageLevel = z.enum([...LANGUAGE_LEVELS, "unknown"]);

export const cvExtractionSchema = z.object({
  personal: z.object({
    first_name: text("Fornavn (inkludert mellomnavn)."),
    last_name: text("Etternavn."),
    email: text("E-postadresse."),
    phone: text("Telefonnummer slik det står, med landskode hvis oppgitt."),
    address: text("Gateadresse uten postnummer og sted."),
    postal_code: text("Postnummer."),
    city: text("Poststed eller by."),
    country: text("Land, på norsk (f.eks. «Norge»)."),
    birth_date: date("Fødselsdato."),
    linkedin_url: text("Full LinkedIn-URL."),
    website_url: text("Personlig nettside eller portefølje."),
    github_url: text("Full GitHub-URL."),
    headline: text("Kort profesjonell tittel, f.eks. «Frontend-utvikler». Bare hvis CV-en angir en tittel eller rolle tydelig."),
    summary: text("Profil- eller sammendragstekst fra CV-en, ordrett eller lett redigert."),
  }),
  experiences: z
    .array(
      z.object({
        title: z.string().describe("Stillingstittel."),
        employer: z.string().describe("Arbeidsgiver."),
        location: text("Sted."),
        start_date: date("Startdato."),
        end_date: date("Sluttdato. Tom streng hvis pågående."),
        is_current: z.boolean().describe("true hvis stillingen er pågående (f.eks. «nå», «d.d.», «present»)."),
        employment_percentage: z.number().int().describe("Stillingsprosent 1–100 hvis CV-en oppgir det (f.eks. «50 % stilling», «deltid 40 %», «part-time 60%»). 0 hvis ikke oppgitt."),
        description: text("Ansvar og oppgaver, kort og på originalspråket."),
      }),
    )
    .describe("Arbeidserfaring, nyeste først. Ikke ta med verv eller frivillig arbeid her."),
  volunteering: z
    .array(
      z.object({
        role: z.string().describe("Rolle eller verv."),
        organization: z.string().describe("Organisasjon."),
        location: text("Sted."),
        start_date: date("Startdato."),
        end_date: date("Sluttdato. Tom streng hvis pågående."),
        is_current: z.boolean(),
        description: text("Kort beskrivelse."),
      }),
    )
    .describe("Verv, tillitsverv, styreverv og frivillig arbeid."),
  educations: z
    .array(
      z.object({
        school: z.string().describe("Skole eller lærested."),
        degree: text("Grad eller nivå, f.eks. «Bachelor», «Master», «Vitnemål videregående»."),
        field_of_study: text("Fagfelt eller studieretning."),
        location: text("By der skolen ligger."),
        start_date: date("Startdato."),
        end_date: date("Sluttdato eller forventet ferdig."),
        grade: text("Karaktersnitt hvis oppgitt."),
        description: text("Kort beskrivelse, f.eks. oppgave eller fordypning."),
      }),
    )
    .describe("Formell utdanning, nyeste først."),
  certifications: z
    .array(
      z.object({
        name: z.string().describe("Navn på kurs eller sertifisering."),
        issuer: text("Utsteder."),
        issued_date: date("Dato."),
        url: text("Lenke hvis oppgitt."),
      }),
    )
    .describe("Kurs, sertifiseringer og sertifikater (f.eks. førerkort)."),
  skills: z
    .array(
      z.object({
        name: z.string().describe("Ferdighet, kort (1–3 ord)."),
        level: skillLevel.describe("Nivå bare hvis CV-en sier det, ellers unknown."),
      }),
    )
    .describe("Faglige ferdigheter, verktøy og teknologier. Ikke språk."),
  languages: z
    .array(
      z.object({
        language: z.string().describe("Språk, på norsk (f.eks. «Engelsk»)."),
        spoken_level: languageLevel,
        written_level: languageLevel,
      }),
    )
    .describe("Språkferdigheter. native = morsmål, fluent = flytende, conversational = godt, basic = grunnleggende."),
});

export type CvExtraction = z.infer<typeof cvExtractionSchema>;

export const SUPPORTED_CV_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;
