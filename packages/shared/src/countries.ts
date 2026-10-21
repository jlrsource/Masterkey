/** Norske landnavn → engelske, for skjemaer med engelske landlister. */
const COUNTRIES: Record<string, string> = {
  norge: "Norway",
  noreg: "Norway",
  sverige: "Sweden",
  danmark: "Denmark",
  finland: "Finland",
  island: "Iceland",
  tyskland: "Germany",
  storbritannia: "United Kingdom",
  england: "United Kingdom",
  "det forente kongerike": "United Kingdom",
  usa: "United States",
  "forente stater": "United States",
  nederland: "Netherlands",
  frankrike: "France",
  spania: "Spain",
  italia: "Italy",
  polen: "Poland",
  østerrike: "Austria",
  sveits: "Switzerland",
  belgia: "Belgium",
  irland: "Ireland",
  portugal: "Portugal",
  hellas: "Greece",
  canada: "Canada",
  australia: "Australia",
  india: "India",
  kina: "China",
  japan: "Japan",
};

/** Engelsk navn på et land skrevet på norsk, eller null hvis ukjent (da er det trolig allerede engelsk). */
export function englishCountry(name: string | null | undefined): string | null {
  return COUNTRIES[(name ?? "").trim().toLowerCase()] ?? null;
}
