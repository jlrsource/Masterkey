import { describe, expect, it } from "vitest";
import { fieldOfStudySearchTerms } from "./fieldOfStudy";

describe("fieldOfStudySearchTerms", () => {
  it.each([
    ["Informatikk", "Computer Science"],
    ["Datateknologi", "Computer Engineering"],
    ["Industriell økonomi og teknologiledelse", "Industrial Engineering"],
    ["Økonomi og administrasjon", "Business Administration"],
    ["Samfunnsøkonomi", "Economics"],
    ["Maskinteknikk", "Mechanical Engineering"],
  ])("%s → %s først", (field, first) => {
    expect(fieldOfStudySearchTerms(field)[0]).toBe(first);
  });
  it("oversetter alle delene av et sammensatt fagfelt", () => {
    const terms = fieldOfStudySearchTerms("Ingeniørvitenskap og IKT");
    expect(terms.slice(0, 2)).toEqual(["Engineering", "Information Technology"]);
    expect(terms).toContain("Ingeniørvitenskap og IKT");
    expect(terms.at(-1)).toBe("IKT");
  });

  it("prøver originalen til slutt, og bare den når ingenting er kjent", () => {
    expect(fieldOfStudySearchTerms("Informatikk").at(-1)).toBe("Informatikk");
    expect(fieldOfStudySearchTerms("Maskinteknikk")[0]).toBe("Mechanical Engineering");
    expect(fieldOfStudySearchTerms("Ukjent fag")).toEqual(["Ukjent fag"]);
  });
});
