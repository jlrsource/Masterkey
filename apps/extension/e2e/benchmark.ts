/**
 * Måler hvor godt Masterkey fyller ut ekte søknadsskjemaer på forskjellige plattformer.
 *
 *   npm run benchmark -w @soknadsprofil/extension            # alle sidene i sites.json
 *   npm run benchmark -w @soknadsprofil/extension -- lever   # bare sider der navn/plattform inneholder «lever»
 *
 * Åpner hvert skjema i Chrome, kjører utfyllingsmotoren (samme filler.js som extensionen) med en
 * oppdiktet testprofil, og teller hvor mange synlige felt som ble fylt ut. Ingenting sendes inn.
 * Resultater (rapport, skjermbilde, HTML-kopi) havner i e2e/results/.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Frame, type Page } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const FILLER = join(here, "../.output/chrome-mv3/filler.js");
const RESULTS = join(here, "results");

interface Site {
  name: string;
  platform: string;
  url?: string;
  resolve?: Record<string, string>;
}

// ---------------------------------------------------------------- finn en aktiv annonse

async function json(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": "Masterkey-benchmark" } });
  if (!res.ok) throw new Error(`${res.status} fra ${url}`);
  return res.json();
}

/** Henter adressen til et søknadsskjema for en aktiv annonse fra plattformens offentlige API. */
async function resolveUrl(site: Site): Promise<string> {
  if (site.url) return site.url;
  const [kind, company] = Object.entries(site.resolve ?? {})[0] ?? [];
  switch (kind) {
    case "greenhouse": {
      const data = await json(`https://boards-api.greenhouse.io/v1/boards/${company}/jobs`);
      const job = data.jobs?.[0];
      if (!job) throw new Error("ingen annonser");
      return `https://job-boards.greenhouse.io/${company}/jobs/${job.id}`;
    }
    case "lever": {
      const data = await json(`https://api.lever.co/v0/postings/${company}?mode=json&limit=1`);
      if (!data[0]) throw new Error("ingen annonser");
      return `${data[0].hostedUrl}/apply`;
    }
    case "ashby": {
      const data = await json(`https://api.ashbyhq.com/posting-api/job-board/${company}`);
      const job = data.jobs?.[0];
      if (!job) throw new Error("ingen annonser");
      return `${job.jobUrl}/application`;
    }
    case "workable": {
      const data = await json(`https://apply.workable.com/api/v1/widget/accounts/${company}`);
      const job = data.jobs?.[0];
      if (!job) throw new Error("ingen annonser");
      return `https://apply.workable.com/${company}/j/${job.shortcode}/apply/`;
    }
    case "smartrecruiters": {
      const data = await json(`https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=1`);
      const job = data.content?.[0];
      if (!job) throw new Error("ingen annonser");
      return `https://jobs.smartrecruiters.com/oneclick-ui/company/${company}/publication/${job.uuid ?? job.id}?dcr_ci=${company}`;
    }
  }
  throw new Error(`ukjent resolve: ${kind}`);
}

// ---------------------------------------------------------------- testdata

/** En liten, gyldig PDF, så filfelt kan testes. */
function dummyPdfBase64(): string {
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  return Buffer.from(pdf).toString("base64");
}

const profile = JSON.parse(readFileSync(join(here, "test-profile.json"), "utf8"));
const payload = {
  profile,
  files: { cvFile: { name: "Kari_Nordmann_CV.pdf", mime: "application/pdf", base64: dummyPdfBase64() } },
  overwrite: false,
};

// ---------------------------------------------------------------- måling i siden

interface FieldInfo {
  label: string;
  type: string;
  required: boolean;
  filled: boolean;
  value: string;
}

/** Kjører i siden: alle synlige felt, med label, om de er påkrevd og om de har en verdi. */
function collectFields(): FieldInfo[] {
  const visible = (el: Element) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && el.getClientRects().length > 0;
  };
  const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  const labelOf = (el: HTMLElement) => {
    const labels = (el as HTMLInputElement).labels;
    if (labels?.length) return text(Array.from(labels).map((l) => l.textContent).join(" "));
    const by = el.getAttribute("aria-labelledby");
    if (by) return text(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
    return text(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name") || el.id);
  };
  /** react-select o.l.: valget vises i et eget element ved siden av, mens selve tekstfeltet er tomt. */
  const shownValue = (el: HTMLElement) => {
    const control = el.closest('[class*="control" i]') ?? el.parentElement?.parentElement;
    const shown = control?.querySelector('[class*="single-value" i], [class*="singleValue" i], [class*="multi-value" i], [class*="multiValue" i]');
    return text(shown?.textContent);
  };
  const out: FieldInfo[] = [];
  const els = document.querySelectorAll<HTMLElement>(
    'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]), textarea, select, button[aria-haspopup="listbox"], [role="combobox"]:not(input)',
  );
  const radioGroups = new Set<string>();
  for (const el of Array.from(els)) {
    const input = el as HTMLInputElement;
    // Filfelt er ofte skjult bak en knapp; tell dem likevel.
    if (input.type !== "file" && !visible(el)) continue;
    if (input.type === "radio") {
      if (radioGroups.has(input.name)) continue;
      radioGroups.add(input.name);
    }
    const label = labelOf(el);
    let filled: boolean;
    if (input.type === "checkbox" || input.type === "radio") {
      filled = input.type === "radio" ? Boolean(document.querySelector(`input[type=radio][name="${CSS.escape(input.name)}"]:checked`)) : input.checked;
    } else if (input.type === "file") filled = (input.files?.length ?? 0) > 0;
    else if (el instanceof HTMLSelectElement) filled = el.selectedIndex > 0 || (el.value !== "" && el.selectedIndex === 0 && !/select|velg|choose/i.test(el.options[0]?.text ?? ""));
    else if (el instanceof HTMLInputElement && el.getAttribute("role") === "combobox") filled = el.value.trim() !== "" || Boolean(shownValue(el));
    else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) filled = el.value.trim() !== "";
    else filled = !/^(select|velg|choose)/i.test(text(el.textContent));
    const required = input.required || el.getAttribute("aria-required") === "true" || /\*/.test(label);
    const value =
      input.type === "file"
        ? Array.from(input.files ?? []).map((f) => f.name).join(", ")
        : el instanceof HTMLSelectElement
          ? text(el.selectedOptions[0]?.text)
          : el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
            ? input.type === "checkbox" || input.type === "radio"
              ? String(filled)
              : text(el.value) || (el.getAttribute("role") === "combobox" ? shownValue(el) : "")
            : text(el.textContent);
    out.push({ label: label || "(uten label)", type: input.type || el.tagName.toLowerCase(), required, filled, value });
  }
  return out;
}

async function dismissCookies(page: Page) {
  const texts = ["Accept all", "Accept All", "Accept", "I agree", "Allow all", "Godta alt", "Godta alle", "Godta", "Aksepter alle", "Aksepter", "OK"];
  for (const t of texts) {
    const btn = page.getByRole("button", { name: t, exact: true }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 2000 }).catch(() => {});
      return;
    }
  }
}

/** Rammen som inneholder skjemaet (mange plattformer legger det i en iframe). */
async function formFrame(page: Page): Promise<{ frame: Frame; crossOrigin: boolean }> {
  const main = page.mainFrame();
  const count = (f: Frame) => f.locator("input:visible, textarea:visible, select:visible").count().catch(() => 0);
  let best = main;
  let bestCount = await count(main);
  for (const f of page.frames()) {
    if (f === main) continue;
    const c = await count(f);
    if (c > bestCount + 2) {
      best = f;
      bestCount = c;
    }
  }
  const crossOrigin = best !== main && new URL(best.url()).origin !== new URL(page.url()).origin;
  return { frame: best, crossOrigin };
}

// ---------------------------------------------------------------- kjøring

interface Result {
  name: string;
  platform: string;
  url: string;
  error?: string;
  crossOriginFrame?: boolean;
  fields?: number;
  filled?: number;
  requiredEmpty?: string[];
  unrecognized?: string[];
  sections?: string[];
  empty?: string[];
  filledValues?: string[];
  ms?: number;
}

async function runSite(site: Site, page: Page): Promise<Result> {
  const started = Date.now();
  const engineLog: string[] = [];
  page.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("[Masterkey]")) engineLog.push(t);
  });
  let url = "";
  try {
    url = await resolveUrl(site);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await dismissCookies(page);
    // Noen sider laster skjemaet (ofte i en iframe) først når man scroller ned.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

    let { frame, crossOrigin } = await formFrame(page);
    // Mange stillingssider viser skjemaet først etter et klikk på «Apply»/«Søk».
    if ((await frame.locator("input:visible, textarea:visible").count().catch(() => 0)) < 3) {
      const apply = page.getByRole("button", { name: /^(apply|apply now|apply for this job|application|søk|søk nå|søk på stillingen|søknad)$/i })
        .or(page.getByRole("link", { name: /^(apply|apply now|apply for this job|application|søk|søk nå|søk på stillingen|søknad)$/i }))
        .or(page.getByRole("tab", { name: /^(application|søknad)$/i }))
        .first();
      if (await apply.isVisible().catch(() => false)) {
        await apply.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(4000);
        ({ frame, crossOrigin } = await formFrame(page));
      }
    }
    await frame.addScriptTag({ content: readFileSync(FILLER, "utf8") });
    const report: any = await frame.evaluate(async (p) => {
      const engine = (window as any).__soknadsprofil;
      if (!engine) throw new Error("motoren ble ikke lastet");
      return engine.fill(p);
    }, payload);
    await page.waitForTimeout(800);

    const fields = await frame.evaluate(collectFields);
    const dir = join(RESULTS, site.name.replace(/[^\w-]+/g, "_"));
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, "screenshot.png"), fullPage: true }).catch(() => {});
    writeFileSync(join(dir, "page.html"), await frame.content());
    const result: Result = {
      name: site.name,
      platform: site.platform,
      url,
      crossOriginFrame: crossOrigin,
      fields: fields.length,
      filled: fields.filter((f) => f.filled).length,
      requiredEmpty: fields.filter((f) => f.required && !f.filled && f.type !== "checkbox").map((f) => `${f.label.slice(0, 70)} [${f.type}]`),
      empty: fields.filter((f) => !f.filled).map((f) => `${f.label} [${f.type}]`),
      // Ikke avkrysningsbokser/radioknapper: de er for mange til å lese i en oversikt.
      filledValues: fields.filter((f) => f.filled && !["checkbox", "radio"].includes(f.type)).map((f) => `${f.label.slice(0, 40)} = «${f.value.slice(0, 40)}»`),
      unrecognized: report.unrecognized ?? [],
      sections: (report.fields ?? []).filter((f: any) => ["experiences", "educations", "volunteering", "languages", "websites"].includes(f.key)).map((f: any) => f.label),
      ms: Date.now() - started,
    };
    writeFileSync(join(dir, "report.json"), JSON.stringify({ ...result, engineReport: report, fieldDetails: fields, engineLog }, null, 2));
    return result;
  } catch (e) {
    return { name: site.name, platform: site.platform, url, error: e instanceof Error ? e.message.split("\n")[0] : String(e), ms: Date.now() - started };
  }
}

async function main() {
  if (!existsSync(FILLER)) {
    console.error("Fant ikke filler.js. Kjør først: npm run build -w @soknadsprofil/extension");
    process.exit(1);
  }
  const filter = process.argv[2]?.toLowerCase();
  const { sites } = JSON.parse(readFileSync(join(here, "sites.json"), "utf8")) as { sites: Site[] };
  const selected = sites.filter((s) => !filter || s.name.toLowerCase().includes(filter) || s.platform.includes(filter));

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  // bypassCSP: extensionen kjører i et isolert miljø som ikke stoppes av sidens CSP. Det etterligner vi her.
  const context = await browser.newContext({ locale: "nb-NO", viewport: { width: 1280, height: 900 }, bypassCSP: true });
  const results: Result[] = [];
  for (const site of selected) {
    const page = await context.newPage();
    process.stdout.write(`${site.name} … `);
    const r = await runSite(site, page);
    results.push(r);
    console.log(r.error ? `FEIL: ${r.error}` : `${r.filled}/${r.fields} felt fylt ut`);
    await page.close();
  }
  await browser.close();

  console.log("\n================ Resultat ================");
  for (const r of results) {
    console.log(`\n${r.name}  (${r.platform})`);
    console.log(`  ${r.url}`);
    if (r.error) {
      console.log(`  FEIL: ${r.error}`);
      continue;
    }
    const pct = r.fields ? Math.round((100 * r.filled!) / r.fields) : 0;
    console.log(`  Fylt ut: ${r.filled}/${r.fields} (${pct} %)${r.crossOriginFrame ? "  ⚠ skjemaet ligger i en iframe fra et annet domene" : ""}`);
    if (r.sections?.length) console.log(`  Seksjoner: ${r.sections.join(", ")}`);
    if (r.filledValues?.length) console.log(`  Utfylt: ${r.filledValues.join(" | ")}`);
    if (r.requiredEmpty?.length) console.log(`  Påkrevd, men tomt: ${r.requiredEmpty.join(" | ")}`);
    if (r.unrecognized?.length) console.log(`  Ikke gjenkjent: ${r.unrecognized.slice(0, 12).join(" | ")}`);
  }
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, "summary.json"), JSON.stringify(results, null, 2));
  console.log(`\nDetaljer: ${RESULTS}`);
}

void main();
