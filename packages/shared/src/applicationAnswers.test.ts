import { describe, expect, it } from "vitest";
import { findSavedAnswer, isConsentQuestion, prefAnswer, prefOptionIndex } from "./applicationAnswers";
import { emptyProfile, type FullProfile } from "./schema";

const withPrefs = (application_prefs: NonNullable<FullProfile["personal"]>["application_prefs"]): FullProfile => ({
  ...emptyProfile(),
  personal: { first_name: "Kari", application_prefs },
});

describe("prefAnswer", () => {
  const p = withPrefs({ work_auth: ["norway", "eu_eea"], needs_sponsorship: "no" });
  it("svarer på arbeidstillatelse ut fra landet i spørsmålet", () => {
    expect(prefAnswer("workAuthorization", p, "Are you legally authorized to work in Norway?")).toEqual({ value: "yes", sure: true });
    expect(prefAnswer("workAuthorization", p, "Are you authorized to work in the United States?")).toEqual({ value: "no", sure: true });
    expect(prefAnswer("workAuthorization", p, "Har du lov til å jobbe i EU/EØS?")).toEqual({ value: "yes", sure: true });
  });
  it("antar Norge når spørsmålet ikke nevner land, men merker det som usikkert", () => {
    expect(prefAnswer("workAuthorization", p, "Are you authorized to work in the country where this job is located?")).toEqual({ value: "yes", sure: false });
  });
  it("gir ingenting når brukeren ikke har svart", () => {
    expect(prefAnswer("relocate", p)).toBeNull();
    expect(prefAnswer("workAuthorization", withPrefs({}), "Norway?")).toBeNull();
  });
});

describe("prefOptionIndex", () => {
  it("finner Ja/Nei på norsk og engelsk, også med forklaring etter", () => {
    expect(prefOptionIndex("needsSponsorship", ["Yes, I will require sponsorship", "No"], "no")).toBe(1);
    expect(prefOptionIndex("relocate", ["Nei", "Ja"], "yes")).toBe(1);
  });
  it("skiller man og woman", () => {
    const opts = ["Woman", "Man", "Non-binary", "Prefer not to disclose"];
    expect(prefOptionIndex("gender", opts, "man")).toBe(1);
    expect(prefOptionIndex("gender", opts, "woman")).toBe(0);
    expect(prefOptionIndex("gender", opts, "undisclosed")).toBe(3);
  });
  it("arbeidsform og kilde", () => {
    expect(prefOptionIndex("workMode", ["On-site", "Hybrid", "Remote"], "remote")).toBe(2);
    expect(prefOptionIndex("heardAbout", ["Company website", "LinkedIn", "Other"], "LinkedIn")).toBe(1);
  });
});

describe("isConsentQuestion", () => {
  it("kjenner igjen samtykker og erklæringer", () => {
    expect(isConsentQuestion("I agree to the privacy policy")).toBe(true);
    expect(isConsentQuestion("Jeg bekrefter at opplysningene er riktige")).toBe(true);
    expect(isConsentQuestion("Jeg samtykker til at søknaden lagres")).toBe(true);
    expect(isConsentQuestion("Are you willing to relocate?")).toBe(false);
  });
});

describe("findSavedAnswer", () => {
  const answers = [
    { question: "Have you previously worked for Spotify?", answer: "No", tags: ["husket"] },
    { question: "What is your favourite programming language?", answer: "TypeScript", tags: [] },
  ];
  it("finner likt spørsmål uansett tegnsetting og store bokstaver", () => {
    expect(findSavedAnswer("have you previously worked for spotify", answers)).toMatchObject({ exact: true, answer: { answer: "No" } });
  });
  it("finner nesten likt spørsmål, men merker det", () => {
    expect(findSavedAnswer("What is your favourite programming language? *", answers)?.exact).toBe(true);
    expect(findSavedAnswer("What's your favourite programming language", answers)).toMatchObject({ exact: false });
  });
  it("regner spørsmål om ulike firma som ulike, selv om resten er likt", () => {
    const long = [{ question: "Have you previously been employed by KPMG or any of its member firms in the last five years?", answer: "No", tags: [] }];
    expect(findSavedAnswer("Have you previously been employed by Deloitte or any of its member firms in the last five years?", long)).toBeNull();
    expect(findSavedAnswer("Have you previously been employed by KPMG or any of its member firms in the past five years?", long)).toMatchObject({ exact: false });
  });
  it("finner ikke ulike spørsmål", () => {
    expect(findSavedAnswer("Have you previously worked for Google?", answers)).toBeNull();
  });
});

describe("tidligere ansatt", () => {
  const p: FullProfile = {
    ...emptyProfile(),
    experiences: [{ employer: "Dun & Bradstreet Norge AS", title: "Analytiker", start_date: "2020-01-01", end_date: "2022-01-01", is_current: false, sort_order: 0 }],
  };
  const options = ["No previous work experience with the company", "Former employee or intern", "Former contractor", "Current employee or intern", "Current contractor"];
  it("kjenner igjen firmanavn på flere ord og velger «Former employee»", () => {
    const a = prefAnswer("previousEmployer", p, "Are you a current or previous employee of Dun & Bradstreet?");
    expect(a).toEqual({ value: "yes", sure: true });
    expect(options[prefOptionIndex("previousEmployer", options, a!.value)]).toBe("Former employee or intern");
  });
  it("velger «No previous work experience» når firmaet ikke står i profilen", () => {
    const a = prefAnswer("previousEmployer", p, "Are you a current or previous employee of KPMG?");
    expect(a?.value).toBe("no");
    expect(options[prefOptionIndex("previousEmployer", options, "no")]).toBe("No previous work experience with the company");
  });
});
