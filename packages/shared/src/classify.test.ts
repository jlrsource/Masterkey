import { describe, expect, it } from "vitest";
import { classifyField, normalize, type FieldDescriptor } from "./classify";
import type { FieldKey } from "./fields";

const input = (d: Partial<FieldDescriptor>): FieldDescriptor => ({ tag: "input", type: "text", ...d });

const cases: [string, FieldDescriptor, FieldKey | null][] = [
  // Norske labels
  ["fornavn label", input({ label: "Fornavn *" }), "firstName"],
  ["etternavn label", input({ label: "Etternavn" }), "lastName"],
  ["navn label", input({ label: "Navn" }), "fullName"],
  ["e-post label", input({ label: "E-post" }), "email"],
  ["epostadresse", input({ label: "Din e-postadresse" }), "email"],
  ["mobil", input({ label: "Mobilnummer" }), "phone"],
  ["postnummer", input({ label: "Postnr." }), "postalCode"],
  ["poststed", input({ label: "Poststed" }), "city"],
  ["fødselsdato", input({ label: "Fødselsdato", type: "date" }), "birthDate"],
  ["lønnskrav", input({ label: "Lønnskrav" }), "salaryExpectation"],
  ["oppstart", input({ label: "Når kan du tiltre? Oppsigelsestid" }), "availability"],
  ["søknadsbrev fil", input({ type: "file", label: "Last opp søknadsbrev" }), "coverLetterFile"],
  ["cv fil", input({ type: "file", label: "Last opp CV" }), "cvFile"],
  ["sammendrag textarea", { tag: "textarea", label: "Kort om deg" }, "summary"],
  ["vitnemål fil", input({ type: "file", label: "Vitnemål * Vitnemålsportalen" }), "diplomaFile"],
  ["vitnemål med CV-filnavn", input({ type: "file", label: "Vitnemål * CV_Julian.pdf" }), "diplomaFile"],
  ["bilde fil", input({ type: "file", label: "Bilde" }), null],
  ["annen dokumentasjon fil", input({ type: "file", label: "Annen dokumentasjon" }), null],
  ["video-cv fil", input({ type: "file", label: "Video-CV" }), null],
  ["fil uten tekst", input({ type: "file", name: "file_3" }), null],
  ["nynorsk studium", { tag: "textarea", label: "Kva heiter studiet ditt? *" }, "fieldOfStudy"],
  ["nynorsk studiestad", { tag: "textarea", label: "Kva heiter studiestaden din? NTNU, HVL, UiB etc *" }, "school"],
  ["nynorsk studieby", { tag: "textarea", label: "Kva stad/by er du student? *" }, "studyCity"],
  ["snittkarakter", { tag: "textarea", label: "Kva er din snittkarakter? *" }, "grade"],
  ["karaktersnitt", input({ label: "Karaktersnitt" }), "grade"],
  ["års erfaring", input({ label: "Hvor mange års relevant erfaring har du?*" }), "yearsExperience"],
  ["years of experience", input({ label: "Years of experience" }), "yearsExperience"],
  ["fødselsår", { tag: "select", label: "Fødselsår*" }, "birthDate"],
  ["bosted er fortsatt by", input({ label: "By" }), "city"],
  ["web address er nettside", input({ id: "webAddress--123", label: "URL*" }), "website"],
  ["adresse er fortsatt adresse", input({ label: "Adresse" }), "address"],
  // Engelske labels
  ["first name", input({ label: "First name" }), "firstName"],
  ["last name", input({ label: "Last Name" }), "lastName"],
  ["full name", input({ label: "Full name" }), "fullName"],
  ["linkedin", input({ label: "LinkedIn Profile URL" }), "linkedin"],
  ["zip", input({ placeholder: "Zip code" }), "postalCode"],
  ["resume file", input({ type: "file", ariaLabel: "Upload resume" }), "cvFile"],
  // Attributter uten label
  ["name attr camelCase", input({ name: "applicant[firstName]" }), "firstName"],
  ["id snake_case", input({ id: "last_name" }), "lastName"],
  ["autocomplete", input({ autocomplete: "given-name", label: "Whatever" }), "firstName"],
  ["type email", input({ type: "email" }), "email"],
  ["type tel", input({ type: "tel", name: "field_7" }), "phone"],
  ["bekreft e-post", input({ label: "Bekreft e-post" }), "email"],
  // Skal ikke treffe
  ["brukernavn", input({ label: "Brukernavn" }), null],
  ["passord", input({ type: "password", label: "Passord" }), null],
  ["ukjent", input({ label: "Har du førerkort?" }), null],
  ["referred by", input({ label: "Referred by" }), null],
];

describe("classifyField", () => {
  it.each(cases)("%s", (_name, descriptor, expected) => {
    expect(classifyField(descriptor)?.key ?? null).toBe(expected);
  });

  it("gir høy konfidens på tydelige labels", () => {
    expect(classifyField(input({ label: "Fornavn" }))!.confidence).toBeGreaterThanOrEqual(0.75);
  });
});

describe("normalize", () => {
  it("splitter camelCase og tegn", () => {
    expect(normalize("applicant[firstName]")).toBe("applicant first name");
    expect(normalize("E-post:")).toBe("e post");
  });
  it("beholder æøå", () => {
    expect(normalize("Fødselsdato på Ålesund")).toBe("fødselsdato på ålesund");
  });
});
