import { describe, expect, it } from "vitest";
import { bestDegreeOptionIndex, degreeLevel } from "./degree";

describe("degreeLevel", () => {
  it.each([
    ["Master i informatikk", "master"],
    ["Mastergrad", "master"],
    ["MSc Computer Science", "master"],
    ["Bachelor i økonomi og administrasjon", "bachelor"],
    ["Bachelor of Science", "bachelor"],
    ["Videregående skole, studiespesialisering", "highschool"],
    ["Fagbrev elektriker", "vocational"],
    ["Årsstudium i psykologi", "oneyear"],
    ["Ph.D. in Physics", "phd"],
    ["", null],
    ["Informatikk", null],
  ])("%s → %s", (text, level) => {
    expect(degreeLevel(text)).toBe(level);
  });
});

describe("bestDegreeOptionIndex med fagretning (Workday-listen fra 19. okt)", () => {
  const options = [
    "Select One", "Bachelor of Arts (B.A.)", "Bachelor of Science (B.S.)", "Bachelor of Commerce (BCom)", "Bachelor of Business (BBus)",
    "Master of Arts (M.A.)", "Master of Science (M.S.)", "Master of Business Administration (MBA)", "Juris Doctor (JD)",
  ];
  const pick = (value: string, context = "") => options[bestDegreeOptionIndex(options, value, context)];

  it.each([
    ["Integrert master", "", "Master of Science (M.S.)"],
    ["Integrert master", "Datateknologi, NTNU", "Master of Science (M.S.)"],
    ["Master", "Informatikk", "Master of Science (M.S.)"],
    ["Master", "Historie", "Master of Arts (M.A.)"],
    ["Master i økonomi og administrasjon", "NHH", "Master of Science (M.S.)"],
    ["MBA", "", "Master of Business Administration (MBA)"],
    ["Bachelor", "Økonomi og administrasjon", "Bachelor of Business (BBus)"],
    ["Bachelor", "Pedagogikk", "Bachelor of Arts (B.A.)"],
    ["Bachelor", "Informatikk", "Bachelor of Science (B.S.)"],
  ])("%s (%s) → %s", (value, context, expected) => {
    expect(pick(value, context)).toBe(expected);
  });

  it("tolker ikke Juris Doctor som doktorgrad", () => {
    expect(bestDegreeOptionIndex(options, "Doktorgrad")).toBe(-1);
  });
});

describe("bestDegreeOptionIndex", () => {
  const workday = ["Select One", "High School or equivalent", "Associate's Degree", "Bachelor's Degree", "Master's Degree", "Master of Business Administration", "Doctorate"];
  it("velger samme nivå, korteste alternativ", () => {
    expect(workday[bestDegreeOptionIndex(workday, "Master i informatikk")]).toBe("Master's Degree");
    expect(workday[bestDegreeOptionIndex(workday, "Bachelor i økonomi")]).toBe("Bachelor's Degree");
    expect(workday[bestDegreeOptionIndex(workday, "Videregående")]).toBe("High School or equivalent");
    expect(workday[bestDegreeOptionIndex(workday, "Doktorgrad")]).toBe("Doctorate");
  });
  it("gir -1 når nivået er ukjent", () => {
    expect(bestDegreeOptionIndex(workday, "Informatikk")).toBe(-1);
  });
});
