import { describe, expect, it } from "vitest";
import { computeCompleteness } from "./completeness";
import { formatDateForInput, resolveValue, yearsOfExperience } from "./resolve";
import { emptyProfile, type FullProfile } from "./schema";

const profile: FullProfile = {
  ...emptyProfile(),
  personal: { first_name: "Kari", last_name: "Nordmann", email: "kari@example.no", phone: "+47 900 00 000" },
  experiences: [
    { employer: "Gammel AS", title: "Junior", start_date: "2018-01-01", is_current: false, sort_order: 1 },
    { employer: "Ny AS", title: "Senior utvikler", start_date: "2021-03-01", is_current: true, sort_order: 0 },
  ],
  saved_answers: [{ question: "Lønnskrav?", answer: "Etter avtale", tags: ["lønnskrav"] }],
  documents: [
    { type: "cv", file_name: "gammel.pdf", storage_path: "u/1", is_default: false },
    { type: "cv", file_name: "ny.pdf", storage_path: "u/2", is_default: true },
  ],
};

describe("resolveValue", () => {
  it("setter sammen fullt navn", () => {
    expect(resolveValue("fullName", profile)).toEqual({ kind: "text", value: "Kari Nordmann" });
  });
  it("velger nåværende jobb", () => {
    expect(resolveValue("currentEmployer", profile)).toEqual({ kind: "text", value: "Ny AS" });
  });
  it("fyller ikke nåværende arbeidsgiver uten nåværende jobb", () => {
    const p = { ...profile, experiences: profile.experiences.map((e) => ({ ...e, is_current: false })) };
    expect(resolveValue("currentEmployer", p)).toBeNull();
    expect(resolveValue("currentTitle", p)).toBeNull();
  });
  it("henter standardsvar via tag", () => {
    expect(resolveValue("salaryExpectation", profile)).toEqual({ kind: "text", value: "Etter avtale" });
  });
  it("velger standard-CV", () => {
    const v = resolveValue("cvFile", profile);
    expect(v?.kind === "file" && v.document.file_name).toBe("ny.pdf");
  });
  it("returnerer null for tomme felt", () => {
    expect(resolveValue("city", profile)).toBeNull();
  });
});

describe("formatDateForInput", () => {
  it("formaterer etter input-type", () => {
    expect(formatDateForInput("1995-04-17", "date")).toBe("1995-04-17");
    expect(formatDateForInput("1995-04-17", "text")).toBe("17.04.1995");
  });
});

describe("computeCompleteness", () => {
  it("gir 0 for tom profil og foreslår neste steg", () => {
    const c = computeCompleteness(emptyProfile());
    expect(c.score).toBe(0);
    expect(c.next).toBeDefined();
  });
  it("teller oppfylte punkter", () => {
    expect(computeCompleteness(profile).score).toBeGreaterThan(20);
  });
});

describe("yearsOfExperience", () => {
  const today = new Date("2026-10-21");
  it("summerer perioder og teller overlapp én gang", () => {
    const p: FullProfile = {
      ...emptyProfile(),
      experiences: [
        { employer: "A", title: "x", start_date: "2018-01-01", end_date: "2020-01-01", is_current: false, sort_order: 0 },
        { employer: "B", title: "y", start_date: "2019-01-01", end_date: "2021-01-01", is_current: false, sort_order: 1 }, // overlapper
        { employer: "C", title: "z", start_date: "2023-10-21", is_current: true, sort_order: 2 },
      ],
    };
    expect(yearsOfExperience(p, today)).toBe(6); // 2018–2021 (3 år) + 2023–2026 (3 år)
  });
  it("gir null uten datoer", () => {
    expect(yearsOfExperience(emptyProfile(), today)).toBeNull();
  });
});
