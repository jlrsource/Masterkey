import { describe, expect, it } from "vitest";
import { languageLevelOptionIndex, languageOptionIndex, overallLanguageLevel } from "./languageMatch";

describe("languageOptionIndex", () => {
  const options = ["Select One", "Danish", "English", "English (US)", "Norwegian", "Norwegian (Nynorsk)", "Swedish"];
  it.each([
    ["Engelsk", "English"],
    ["engelsk", "English"],
    ["Norsk", "Norwegian"],
    ["English", "English"],
    ["Svensk", "Swedish"],
  ])("%s → %s", (lang, expected) => {
    expect(options[languageOptionIndex(options, lang)]).toBe(expected);
  });
  it("gir -1 for ukjent språk", () => {
    expect(languageOptionIndex(options, "Klingon")).toBe(-1);
  });
});

describe("languageLevelOptionIndex", () => {
  it("forstår Webcruiters skala (Ingen/Noe/Godt/Meget godt), også med «Muntlig» foran", () => {
    const wc = ["Muntlig Ingen", "Muntlig Noe", "Muntlig Godt", "Muntlig Meget godt"];
    expect(wc[languageLevelOptionIndex(wc, "native")]).toBe("Muntlig Meget godt");
    expect(wc[languageLevelOptionIndex(wc, "fluent")]).toBe("Muntlig Meget godt");
    expect(wc[languageLevelOptionIndex(wc, "conversational")]).toBe("Muntlig Godt");
    expect(wc[languageLevelOptionIndex(wc, "basic")]).toBe("Muntlig Noe");
  });
  const workday = ["Select One", "Beginner", "Intermediate", "Advanced", "Fluent", "Native"];
  const linkedin = ["Elementary proficiency", "Limited working proficiency", "Professional working proficiency", "Full professional proficiency", "Native or bilingual proficiency"];
  it("treffer riktig nivå", () => {
    expect(workday[languageLevelOptionIndex(workday, "native")]).toBe("Native");
    expect(workday[languageLevelOptionIndex(workday, "fluent")]).toBe("Fluent");
    expect(["Beginner", "Intermediate", "Advanced"][languageLevelOptionIndex(["Beginner", "Intermediate", "Advanced"], "fluent")]).toBe("Advanced");
    expect(workday[languageLevelOptionIndex(workday, "conversational")]).toBe("Intermediate");
    expect(workday[languageLevelOptionIndex(workday, "basic")]).toBe("Beginner");
    expect(linkedin[languageLevelOptionIndex(linkedin, "basic")]).toBe("Elementary proficiency");
    expect(linkedin[languageLevelOptionIndex(linkedin, "conversational")]).toBe("Professional working proficiency");
    expect(linkedin[languageLevelOptionIndex(linkedin, "fluent")]).toBe("Full professional proficiency");
    expect(linkedin[languageLevelOptionIndex(linkedin, "native")]).toBe("Native or bilingual proficiency");
  });
  it("faller tilbake til nærmeste nivå under", () => {
    expect(["Basic", "Good", "Fluent"][languageLevelOptionIndex(["Basic", "Good", "Fluent"], "native")]).toBe("Fluent");
  });
});

describe("overallLanguageLevel", () => {
  it("tar det høyeste av muntlig og skriftlig", () => {
    expect(overallLanguageLevel({ spoken_level: "fluent", written_level: "conversational" })).toBe("fluent");
    expect(overallLanguageLevel({ spoken_level: null, written_level: null })).toBeNull();
  });
});
