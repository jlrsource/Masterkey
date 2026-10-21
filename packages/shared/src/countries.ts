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

/** ISO-landkoder (to bokstaver) for vanlige land, brukt i lister som «NO +47». */
const ISO2: Record<string, string> = {
  Norway: "NO", Sweden: "SE", Denmark: "DK", Finland: "FI", Iceland: "IS", Germany: "DE", "United Kingdom": "GB",
  "United States": "US", Netherlands: "NL", France: "FR", Spain: "ES", Italy: "IT", Poland: "PL", Austria: "AT",
  Switzerland: "CH", Belgium: "BE", Ireland: "IE", Portugal: "PT", Greece: "GR", Canada: "CA", Australia: "AU",
  India: "IN", China: "CN", Japan: "JP",
};

export function countryIso2(name: string | null | undefined): string | null {
  const english = englishCountry(name) ?? (name ?? "").trim();
  return ISO2[english] ?? null;
}

/** Retningsnummeret i et telefonnummer på formen «+47 912 34 567» (uten +), eller null. */
export function dialCode(phone: string | null | undefined): string | null {
  const m = /^\s*(?:\+|00)(\d{1,3})[\s-]/.exec(phone ?? "");
  return m?.[1] ?? null;
}
