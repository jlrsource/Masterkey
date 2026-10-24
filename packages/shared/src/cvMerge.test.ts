import { describe, expect, it } from "vitest";
import type { CvExtraction } from "./cvExtraction";
import { buildCvProposal, cleanDate, countSelected } from "./cvMerge";
import { emptyProfile, type FullProfile } from "./schema";

const emptyPersonal: CvExtraction["personal"] = {
  first_name: "", last_name: "", email: "", phone: "", address: "", postal_code: "", city: "",
  country: "", birth_date: "", linkedin_url: "", website_url: "", github_url: "", headline: "", summary: "",
};

const extraction: CvExtraction = {
  personal: { ...emptyPersonal, first_name: "Kari", last_name: "Nordmann", email: "kari@ny.no", city: "Bergen", birth_date: "1995-02-30" },
  experiences: [
    { title: "UX-designer", employer: "Fjord AS", location: "Oslo", start_date: "2021-03-01", end_date: "2023-01-01", is_current: true, employment_percentage: 60, description: "" },
    { title: "Butikkmedarbeider", employer: "Rema 1000", location: "", start_date: "2016", end_date: "", is_current: false, employment_percentage: 0, description: "  " },
    { title: "Butikkmedarbeider", employer: "Rema 1000", location: "", start_date: "", end_date: "", is_current: false, employment_percentage: 0, description: "" },
  ],
  volunteering: [{ role: "Trener", organization: "IL Brann", location: "", start_date: "", end_date: "", is_current: true, description: "" }],
  educations: [],
  certifications: [],
  skills: [
    { name: "Figma", level: "expert" },
    { name: "figma ", level: "unknown" },
    { name: "React", level: "unknown" },
  ],
  languages: [{ language: "Engelsk", spoken_level: "fluent", written_level: "fluent" }],
};

const profile: FullProfile = {
  ...emptyProfile(),
  personal: { first_name: "Kari", email: "kari@gammel.no" },
  experiences: [{ title: "ux-designer", employer: "Fjord AS", is_current: true, sort_order: 0 }],
  skills: [{ name: "React", sort_order: 0 }],
};

describe("buildCvProposal", () => {
  const p = buildCvProposal(extraction, profile);

  it("foreslår bare personalia som er nye eller ulike", () => {
    const keys = p.personal.map((s) => s.key);
    expect(keys).not.toContain("first_name"); // likt
    expect(keys).toEqual(expect.arrayContaining(["last_name", "email", "city"]));
  });

  it("forhåndsvelger tomme felt, men ikke felt som ville blitt overskrevet", () => {
    expect(p.personal.find((s) => s.key === "last_name")?.selected).toBe(true);
    const email = p.personal.find((s) => s.key === "email")!;
    expect(email.selected).toBe(false);
    expect(email.current).toBe("kari@gammel.no");
  });

  it("forkaster ugyldige datoer", () => {
    expect(p.personal.find((s) => s.key === "birth_date")).toBeUndefined();
    expect(p.lists.experiences[1]?.row.start_date).toBeNull();
  });

  it("markerer rader som finnes fra før og fjerner duplikater i CV-en", () => {
    expect(p.lists.experiences).toHaveLength(2);
    expect(p.lists.experiences[0]).toMatchObject({ duplicate: true, selected: false });
    expect(p.lists.experiences[1]).toMatchObject({ duplicate: false, selected: true });
    expect(p.lists.skills.map((s) => [s.row.name, s.duplicate])).toEqual([
      ["Figma", false],
      ["React", true],
    ]);
  });

  it("nullstiller sluttdato for pågående stillinger og tomme tekster", () => {
    expect(p.lists.experiences[0]?.row.end_date).toBeNull();
    expect(p.lists.experiences[0]?.row.employment_percentage).toBe(60);
    expect(p.lists.experiences[1]?.row.employment_percentage).toBeNull(); // 0 = ikke oppgitt
    expect(p.lists.experiences[1]?.row.description).toBeNull();
  });

  it("teller valgte forslag", () => {
    // last_name, city + Rema-jobb + verv + Figma + Engelsk
    expect(countSelected(p)).toBe(6);
  });
});

describe("semikolon", () => {
  it("erstattes med komma i fritekst, men ikke i URL-er", () => {
    const p = buildCvProposal(
      {
        ...extraction,
        personal: { ...emptyPersonal, summary: "Engasjert; strukturert ;løsningsorientert;", website_url: "https://x.no/a;b" },
        experiences: [{ ...extraction.experiences[1]!, description: "Kasse; varemottak; kundeservice" }],
      },
      emptyProfile(),
    );
    expect(p.personal.find((s) => s.key === "summary")?.proposed).toBe("Engasjert, strukturert, løsningsorientert");
    expect(p.personal.find((s) => s.key === "website_url")?.proposed).toBe("https://x.no/a;b");
    expect(p.lists.experiences[0]?.row.description).toBe("Kasse, varemottak, kundeservice");
  });
});

describe("cleanDate", () => {
  it("godtar bare ekte ISO-datoer", () => {
    expect(cleanDate("2021-03-01")).toBe("2021-03-01");
    expect(cleanDate("2021-02-30")).toBeNull();
    expect(cleanDate("mars 2021")).toBeNull();
    expect(cleanDate(null)).toBeNull();
  });
});
