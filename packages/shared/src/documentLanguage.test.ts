import { describe, expect, it } from "vitest";
import { documentLanguage, pickDocument } from "./documentLanguage";
import type { ProfileDocument } from "./schema";

describe("documentLanguage", () => {
  it("leser språket fra filnavnet", () => {
    expect(documentLanguage("Transcript.pdf")).toBe("en");
    expect(documentLanguage("Karakterutskrift.pdf")).toBe("no");
    expect(documentLanguage("Vitnemål NTNU.pdf")).toBe("no");
    expect(documentLanguage("karakterutskrift_EN.pdf")).toBe("en");
    expect(documentLanguage("Engelsk karakterutskrift.pdf")).toBe("en");
    expect(documentLanguage("transcript-norsk.pdf")).toBe("no");
    expect(documentLanguage("scan_0012.pdf")).toBeNull();
  });
});

describe("pickDocument", () => {
  const doc = (file_name: string, is_default = false): ProfileDocument => ({ type: "diploma", file_name, storage_path: file_name, is_default });
  const docs = [doc("Karakterutskrift.pdf", true), doc("Transcript.pdf")];
  it("velger dokumentet på sidens språk", () => {
    expect(pickDocument(docs, "diploma", "en")?.file_name).toBe("Transcript.pdf");
    expect(pickDocument(docs, "diploma", "no")?.file_name).toBe("Karakterutskrift.pdf");
  });
  it("faller tilbake til standarddokumentet", () => {
    expect(pickDocument(docs, "diploma")?.file_name).toBe("Karakterutskrift.pdf");
    expect(pickDocument([doc("scan.pdf", true)], "diploma", "en")?.file_name).toBe("scan.pdf");
  });
});
