/**
 * Norske fagfelt → engelske søkeord. Mange skjemaer (bl.a. Workday) har et søkefelt med bare
 * engelske fagnavn, så «Informatikk» gir ingen treff, mens «Computer Science» gjør det.
 * Rekkefølgen betyr noe: mer spesifikke uttrykk står før generelle («industriell økonomi» før «økonomi»).
 */
const FIELD_TRANSLATIONS: [RegExp, string[]][] = [
  [/industriell økonomi/, ["Industrial Engineering", "Engineering Management"]],
  [/økonomi og administrasjon|siviløkonom|bedriftsøkonomi/, ["Business Administration", "Business"]],
  [/datateknologi|datateknikk/, ["Computer Engineering", "Computer Science"]],
  [/informatikk|datavitenskap|computer science/, ["Computer Science", "Informatics"]],
  [/\bikt\b|informasjons- og kommunikasjonsteknologi/, ["Information Technology", "Information and Communication Technology"]],
  [/informasjonsteknologi|\bit\b|informasjonssystemer/, ["Information Technology", "Information Systems"]],
  [/kunstig intelligens|maskinlæring/, ["Artificial Intelligence", "Computer Science"]],
  [/cybersikkerhet|informasjonssikkerhet/, ["Cyber Security", "Information Security"]],
  [/elektronikk|elektro/, ["Electrical Engineering", "Electronics"]],
  [/maskin|produktutvikling/, ["Mechanical Engineering"]],
  [/bygg|konstruksjon/, ["Civil Engineering"]],
  [/kjemiteknikk|kjemisk prosess/, ["Chemical Engineering"]],
  [/petroleum/, ["Petroleum Engineering"]],
  [/marin teknikk|skipsteknikk/, ["Marine Engineering", "Naval Architecture"]],
  [/energi|miljø/, ["Energy", "Environmental Engineering"]],
  // Generelt ingeniørfag til slutt, så «maskiningeniør» o.l. treffer det spesifikke først.
  [/ingeniørvitenskap|ingeniørfag|ingeniør|sivilingeniør|engineering/, ["Engineering"]],
  [/matematikk/, ["Mathematics"]],
  [/statistikk/, ["Statistics"]],
  [/fysikk/, ["Physics"]],
  [/kjemi/, ["Chemistry"]],
  [/biologi|bioteknologi/, ["Biology", "Biotechnology"]],
  [/geologi|geofag/, ["Geology", "Geosciences"]],
  [/medisin/, ["Medicine"]],
  [/sykepleie/, ["Nursing"]],
  [/farmasi/, ["Pharmacy"]],
  [/psykologi/, ["Psychology"]],
  [/rettsvitenskap|\bjus\b|juss/, ["Law"]],
  [/samfunnsøkonomi/, ["Economics"]],
  [/finans/, ["Finance"]],
  [/regnskap|revisjon/, ["Accounting"]],
  [/markedsføring/, ["Marketing"]],
  [/ledelse|organisasjon/, ["Management", "Organizational Behavior"]],
  [/økonomi/, ["Economics", "Business"]],
  [/statsvitenskap/, ["Political Science"]],
  [/sosiologi/, ["Sociology"]],
  [/pedagogikk|lærer/, ["Education"]],
  [/historie/, ["History"]],
  [/filosofi/, ["Philosophy"]],
  [/litteratur/, ["Literature"]],
  [/språk|lingvistikk/, ["Linguistics", "Languages"]],
  [/kommunikasjon|medie|journalistikk/, ["Communications", "Journalism"]],
  [/arkitektur/, ["Architecture"]],
  [/design/, ["Design"]],
];

/**
 * Søkeord å prøve, i rekkefølge: engelske oversettelser for alle delene av fagfeltet
 * («Ingeniørvitenskap og IKT» → Engineering, Information Technology), så originalteksten,
 * og til slutt hver del for seg.
 */
export function fieldOfStudySearchTerms(field: string): string[] {
  const original = field.trim();
  const t = original.toLowerCase();
  // Alle fagord i teksten, sortert etter hvor de står («Ingeniørvitenskap og IKT» → Engineering først).
  // Ved likhet vinner det som står først i listen, altså det mest spesifikke uttrykket.
  const english = FIELD_TRANSLATIONS.map(([re, terms], order) => ({ index: re.exec(t)?.index ?? -1, order, terms }))
    .filter((m) => m.index >= 0)
    .sort((a, b) => a.index - b.index || a.order - b.order)
    .flatMap((m) => m.terms);
  const parts = original.split(/\s+og\s+|\s+and\s+|\s*[,/&+]\s*/i).map((p) => p.trim()).filter(Boolean);
  return [...new Set([...english, original, ...(parts.length > 1 ? parts : [])])].filter(Boolean);
}
