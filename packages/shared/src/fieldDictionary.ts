import type { FieldKey } from "./fields";

/**
 * HTML `autocomplete`-verdier gir sikrest treff.
 * https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
 */
export const AUTOCOMPLETE_MAP: Record<string, FieldKey> = {
  "given-name": "firstName",
  "family-name": "lastName",
  name: "fullName",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "street-address": "address",
  "address-line1": "address",
  "postal-code": "postalCode",
  "address-level2": "city",
  country: "country",
  "country-name": "country",
  bday: "birthDate",
  url: "website",
  organization: "currentEmployer",
  "organization-title": "currentTitle",
};

/**
 * Nøkkelord per felttype (norsk og engelsk). Teksten normaliseres før matching
 * (små bokstaver, camelCase/_/- blir mellomrom). Treff må stå som hele ord,
 * så «navn» matcher ikke «fornavn».
 */
export const KEYWORDS: Record<FieldKey, string[]> = {
  firstName: ["fornavn", "first name", "firstname", "fname", "given name", "givenname", "forename"],
  lastName: ["etternavn", "last name", "lastname", "lname", "surname", "family name", "familyname"],
  fullName: ["fullt navn", "full name", "fullname", "navn", "name", "ditt navn", "your name"],
  email: ["e post", "epost", "e mail", "email", "mail", "e postadresse", "epostadresse", "email address"],
  phone: ["telefon", "telefonnummer", "mobil", "mobilnummer", "tlf", "phone", "phone number", "mobile", "cell", "telephone"],
  address: ["adresse", "gateadresse", "postadresse", "address", "street", "street address", "address line 1", "address1"],
  postalCode: ["postnummer", "postnr", "post nr", "zip", "zip code", "zipcode", "postal code", "postcode", "postal"],
  city: ["poststed", "sted", "by", "city", "town", "bosted"],
  country: ["land", "country", "nasjonalitet"],
  birthDate: ["fødselsdato", "fodselsdato", "født", "fødselsår", "fødeår", "birth date", "date of birth", "birthdate", "dob", "birthday", "year of birth", "birth year"],
  linkedin: ["linkedin", "linked in", "linkedin url", "linkedin profil", "linkedin profile"],
  website: ["nettside", "hjemmeside", "portefølje", "portfolio", "website", "personal website", "web site", "homepage", "url", "web address", "webadresse", "nettadresse"],
  github: ["github", "git hub", "github url", "github profile"],
  headline: ["overskrift", "headline", "profesjonell tittel", "professional title"],
  summary: ["sammendrag", "om deg", "om meg", "kort om deg", "beskriv deg selv", "summary", "about you", "about me", "profile summary", "bio"],
  currentEmployer: ["nåværende arbeidsgiver", "arbeidsgiver", "current employer", "current company", "employer", "company"],
  currentTitle: ["nåværende stilling", "stillingstittel", "stilling", "current title", "job title", "current position", "position", "title"],
  school: [
    "skole", "lærested", "lærestad", "lærestaden", "studiested", "studiestedet", "studiestad", "studiestaden",
    "utdanningsinstitusjon", "utdanningsstad", "universitet", "høgskole", "høgskule", "hvor studerer du", "kvar studerer du",
    "school", "university", "institution", "college", "where do you study",
  ],
  degree: ["grad", "gradsnivå", "utdanningsnivå", "studienivå", "type grad", "bachelor eller master", "degree", "degree level", "qualification"],
  fieldOfStudy: ["fagfelt", "studieretning", "studium", "studiet", "studiet ditt", "studieprogram", "studieprogrammet", "hva studerer du", "kva studerer du", "field of study", "major", "discipline", "programme", "program of study"],
  yearsExperience: [
    "års erfaring", "års relevant erfaring", "år med erfaring", "antall år erfaring", "år arbeidserfaring", "arbeidserfaring år",
    "years of experience", "years experience", "years of relevant experience", "years of work experience", "how many years",
  ],
  grade: ["snittkarakter", "karaktersnitt", "gjennomsnittskarakter", "gjennomsnittlig karakter", "snitt", "gpa", "grade point average", "average grade"],
  studyCity: [
    "studieby", "studiebyen", "by er du student", "stad by er du student", "sted by er du student", "by studerer du",
    "hvilken by studerer du", "kva by studerer du", "study city", "city of study", "city where you study",
  ],
  salaryExpectation: ["lønnskrav", "lønnsforventning", "ønsket lønn", "salary", "salary expectation", "expected salary", "desired salary", "compensation"],
  availability: ["oppstart", "tiltredelse", "oppsigelsestid", "tilgjengelig fra", "start date", "availability", "notice period", "available from", "earliest start"],
  motivation: ["motivasjon", "hvorfor søker du", "hvorfor vil du", "hvorfor oss", "søknadstekst", "motivation", "why do you want", "why are you interested", "cover letter text", "why us"],
  cvFile: ["cv", "resume", "résumé", "curriculum vitae", "last opp cv", "upload cv", "upload resume"],
  coverLetterFile: ["søknadsbrev", "søknad", "følgebrev", "cover letter", "coverletter", "motivasjonsbrev", "letter"],
  diplomaFile: ["vitnemål", "vitnemal", "attest", "attester", "karakterutskrift", "karakterkort", "diploma", "transcript", "transcripts", "grades"],
};

const NON_CV_DOCUMENTS = [
  "vitnemål", "vitnemal", "attest", "attester", "karakter", "karakterutskrift", "diploma", "transcript",
  "bilde", "foto", "photo", "picture", "portrett", "profilbilde", "video", "video cv",
  "dokumentasjon", "annen dokumentasjon", "andre vedlegg", "other documents", "portefølje", "portfolio",
];

/** Ord som betyr at feltet IKKE er av typen, selv om et nøkkelord matcher. */
export const NEGATIVE_KEYWORDS: Partial<Record<FieldKey, string[]>> = {
  fullName: ["fornavn", "etternavn", "first", "last", "company", "firma", "bedrift", "skole", "school", "referanse", "reference", "user name", "username", "brukernavn"],
  email: ["referanse", "reference"],
  // «Web address»/URL er en nettside, ikke en postadresse.
  address: ["url", "web", "website", "nettside", "nett", "e post", "email", "mail", "ip"],
  phone: ["referanse", "reference"],
  city: ["fødested", "birth", "referred", "henvist", "funnet", "hørte", "student", "studerer", "study"],
  country: ["telefon", "phone", "code"],
  currentEmployer: ["tidligere", "previous", "former"],
  currentTitle: ["mr", "mrs", "tiltale", "salutation", "søker", "søke", "apply", "applying"],
  // Filfelt for andre dokumenter skal aldri få CV-en.
  cvFile: ["søknadsbrev", "cover letter", ...NON_CV_DOCUMENTS],
  coverLetterFile: NON_CV_DOCUMENTS,
};
