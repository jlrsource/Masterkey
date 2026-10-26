import { emptyProfile, type FullProfile } from "@soknadsprofil/shared";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { classifyDocument, createEngine, fillDocument } from "@/lib/engine/engine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const profile: FullProfile = {
  ...emptyProfile(),
  personal: {
    first_name: "Kari",
    last_name: "Nordmann",
    email: "kari@example.no",
    phone: "+47 900 00 000",
    address: "Storgata 1",
    postal_code: "0155",
    city: "Oslo",
    country: "Norge",
    birth_date: "1995-04-17",
    linkedin_url: "https://linkedin.com/in/kari",
  },
  experiences: [{ employer: "Fjord AS", title: "UX-designer", is_current: true, sort_order: 0 }],
  saved_answers: [{ question: "Lønnskrav", answer: "Etter avtale", tags: ["lønnskrav"] }],
};

const fill = (overwrite = false) => fillDocument({ profile, files: {}, overwrite }, document);
const value = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.lang = "";
});

describe("fillDocument – norsk skjema (Webcruiter-lignende)", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <div class="row"><label for="a1">Fornavn *</label><input id="a1" name="ctl00$Fornavn"></div>
        <div class="row"><label for="a2">Etternavn *</label><input id="a2"></div>
        <div class="row"><label for="a3">E-post</label><input id="a3" type="email"></div>
        <div class="row"><label for="a4">Bekreft e-post</label><input id="a4" type="email"></div>
        <div class="row"><span>Mobil</span><input id="a5" type="tel"></div>
        <div class="row"><label>Gateadresse <input id="a6"></label></div>
        <div class="row"><label for="a7">Postnr.</label><input id="a7"></div>
        <div class="row"><label for="a8">Poststed</label><input id="a8"></div>
        <div class="row"><label for="a9">Land</label>
          <select id="a9"><option value="">Velg land</option><option value="SE">Sverige</option><option value="NO">Norge</option></select></div>
        <div class="row"><label for="a10">Fødselsdato</label><input id="a10" placeholder="dd.mm.åååå"></div>
        <div class="row"><label for="a11">Lønnskrav</label><input id="a11"></div>
        <div class="row"><label for="a12">Har du førerkort?</label><input id="a12"></div>
        <input type="hidden" name="token" value="x">
        <button type="submit">Send</button>
      </form>`;
  });

  it("fyller ut gjenkjente felt", async () => {
    const report = await fill();
    expect(value("#a1")).toBe("Kari");
    expect(value("#a2")).toBe("Nordmann");
    expect(value("#a3")).toBe("kari@example.no");
    expect(value("#a4")).toBe("kari@example.no");
    expect(value("#a5")).toBe("+47 900 00 000");
    expect(value("#a6")).toBe("Storgata 1");
    expect(value("#a7")).toBe("0155");
    expect(value("#a8")).toBe("Oslo");
    expect(value("#a9")).toBe("NO");
    expect(value("#a10")).toBe("17.04.1995");
    expect(value("#a11")).toBe("Etter avtale");
    expect(value("#a12")).toBe("");
    expect(report.fields.filter((f) => f.status === "filled").length).toBeGreaterThanOrEqual(10);
  });

  it("markerer utfylte felt", async () => {
    await fill();
    expect(document.querySelector("#a1")!.getAttribute("data-soknadsprofil")).toBe("filled");
  });

  it("overskriver ikke felt som allerede har verdi", async () => {
    (document.querySelector("#a1") as HTMLInputElement).value = "Ola";
    await fill();
    expect(value("#a1")).toBe("Ola");
    await fill(true);
    expect(value("#a1")).toBe("Kari");
  });
});

describe("fillDocument – engelsk skjema med attributter", () => {
  it("bruker name/id/autocomplete når label mangler", async () => {
    document.body.innerHTML = `
      <input name="applicant[firstName]">
      <input id="last_name">
      <input autocomplete="email" name="x1">
      <input placeholder="LinkedIn profile URL">
      <input type="date" aria-label="Date of birth">
      <textarea aria-label="Current company"></textarea>`;
    await fill();
    expect(value('[name="applicant[firstName]"]')).toBe("Kari");
    expect(value("#last_name")).toBe("Nordmann");
    expect(value('[name="x1"]')).toBe("kari@example.no");
    expect(value('[placeholder="LinkedIn profile URL"]')).toBe("https://linkedin.com/in/kari");
    expect(value('[type="date"]')).toBe("1995-04-17");
  });

  it("finner labels via aria-labelledby", async () => {
    document.body.innerHTML = `<span id="lbl">Surname</span><input aria-labelledby="lbl" id="s">`;
    await fill();
    expect(value("#s")).toBe("Nordmann");
  });
});

describe("shadow DOM", () => {
  it("finner felt i åpne shadow roots", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    host.attachShadow({ mode: "open" }).innerHTML = `<label for="f">First name</label><input id="f">`;
    await fill();
    expect((host.shadowRoot!.getElementById("f") as HTMLInputElement).value).toBe("Kari");
  });
});

describe("adaptere", () => {
  it("bruker Lever-reglene på lever.co", () => {
    document.body.innerHTML = `<input name="name"><input name="org">`;
    const { matches, adapter } = classifyDocument(document, "jobs.lever.co");
    expect(adapter).toBe("Lever");
    expect(matches.map((m) => m.result.key)).toEqual(["fullName", "currentEmployer"]);
  });
});

describe("React-kontrollerte skjema", () => {
  it("oppdaterer React-state, ikke bare DOM-verdien", async () => {
    let state: Record<string, string> = {};
    function Form() {
      const [v, setV] = useState({ first: "", email: "" });
      state = v;
      return createElement(
        "form",
        null,
        createElement("label", { htmlFor: "rf" }, "Fornavn"),
        createElement("input", { id: "rf", value: v.first, onChange: (e: { target: { value: string } }) => setV((s) => ({ ...s, first: e.target.value })) }),
        createElement("label", { htmlFor: "re" }, "E-post"),
        createElement("input", { id: "re", value: v.email, onChange: (e: { target: { value: string } }) => setV((s) => ({ ...s, email: e.target.value })) }),
      );
    }
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(Form)));
    await act(async () => {
      await fill();
    });
    expect(state).toEqual({ first: "Kari", email: "kari@example.no" });
    root.unmount();
  });
});

describe("skjema med rader og skjulte filknapper (som i testen 7. okt)", () => {
  const row = (title: string, id: string, extra = "") => `
    <div class="row">
      <div class="head"><span class="icon"></span><h3>${title}</h3></div>
      ${extra}
      <button type="button">Last opp<input type="file" id="${id}" style="display:none"></button>
    </div>`;

  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        ${row("CV *", "f-cv")}
        ${row("Bilde", "f-bilde")}
        ${row("Vitnemål *", "f-vitnemal", '<a href="#">Vitnemålsportalen</a>')}
        ${row("Annen dokumentasjon", "f-annen")}
        ${row("Video-CV", "f-video")}
        <div class="q">
          <p>Kva grad tek du? *</p>
          <div class="options">
            <label><input type="checkbox" name="g1"> Bachelor</label>
            <label><input type="checkbox" name="g2"> Master</label>
          </div>
        </div>
        <label for="studie">Kva heiter studiet ditt? *</label>
        <textarea id="studie" placeholder="Skriv inn et svar"></textarea>
        <div class="q">
          <p>Noverande studietrinn? *</p>
          <div><label><input type="checkbox" name="t1"> 1</label><label><input type="checkbox" name="t2"> 2</label></div>
        </div>
      </form>`;
  });

  it("gir hvert filfelt riktig type, og CV-en bare til CV-raden", () => {
    const { matches } = classifyDocument(document, "example.com");
    const byId = Object.fromEntries(matches.map((m) => [m.el.id, m.result.key]));
    expect(byId["f-cv"]).toBe("cvFile");
    expect(byId["f-vitnemal"]).toBe("diplomaFile");
    expect(byId["f-bilde"]).toBeUndefined();
    expect(byId["f-annen"]).toBeUndefined();
    expect(byId["f-video"]).toBeUndefined();
  });

  it("krysser av riktig grad og fyller studiet, men lar ukjente spørsmål være", async () => {
    const withEducation: FullProfile = {
      ...profile,
      educations: [{ school: "UiB", degree: "Master i informatikk", field_of_study: "Informatikk", sort_order: 0 }],
    };
    await fillDocument({ profile: withEducation, files: {}, overwrite: false }, document);
    const checked = (name: string) => (document.querySelector(`[name="${name}"]`) as HTMLInputElement).checked;
    expect(checked("g2")).toBe(true);
    expect(checked("g1")).toBe(false);
    expect(checked("t1") || checked("t2")).toBe(false);
    expect((document.querySelector("#studie") as HTMLTextAreaElement).value).toBe("Informatikk");
  });
});

describe("eneste filfelt uten tekst", () => {
  it("får CV-en som usikker", () => {
    document.body.innerHTML = `<input type="file" name="upload_1">`;
    const { matches } = classifyDocument(document, "example.com");
    expect(matches.map((m) => [m.result.key, m.result.confidence])).toEqual([["cvFile", 0.5]]);
  });

  it("får ingenting når det finnes flere filfelt", () => {
    document.body.innerHTML = `<input type="file" name="upload_1"><input type="file" name="upload_2">`;
    expect(classifyDocument(document, "example.com").matches).toHaveLength(0);
  });
});

describe("«Upload relevant files» (Workday): flere filer i samme felt", () => {
  const file = (name: string) => ({ name, mime: "application/pdf", base64: btoa("pdf") });
  const page = (lang: string, text: string) => {
    document.documentElement.lang = lang;
    document.body.innerHTML = `<h2>${text}</h2><label for="f">Resume/CV</label>
      <input id="f" data-automation-id="file-upload-input-ref" type="file" multiple>`;
  };

  it("legger ved karakterutskriften sammen med CV-en, og ser at siden er engelsk", async () => {
    page("en-US", "Resume/CV. Upload relevant files for your application with the position.");
    // jsdom har ikke DataTransfer, og input.files kan ikke settes der.
    class FakeDataTransfer {
      files: File[] = [];
      items = { add: (f: File) => this.files.push(f) };
    }
    (globalThis as { DataTransfer?: unknown }).DataTransfer = FakeDataTransfer;
    let set: File[] = [];
    Object.defineProperty(document.getElementById("f")!, "files", { get: () => set, set: (v: File[]) => (set = v) });
    const engine = createEngine(document);
    expect(engine.analyze()).toMatchObject({ lang: "en" });
    const p = { ...profile, documents: [{ type: "cv" as const, file_name: "CV.pdf", storage_path: "u/cv", is_default: true }] };
    await engine.fill({ profile: p, files: { cvFile: file("CV.pdf") }, cvExtras: [file("Transcript.pdf")], overwrite: false });
    const names = Array.from((document.getElementById("f") as HTMLInputElement).files ?? []).map((f) => f.name);
    expect(names).toEqual(["CV.pdf", "Transcript.pdf"]);
  });

  it("ser at siden er norsk selv om lang-attributtet sier engelsk", () => {
    page("en", "Last opp CV og vedlegg til søknaden din. Velg filer og lagre før du går til neste steg på siden med utdanning og erfaring.");
    expect(createEngine(document).analyze().lang).toBe("no");
  });

  it("legger ikke ved ekstra filer når siden har eget felt for vitnemål", async () => {
    page("en", "");
    document.body.insertAdjacentHTML("beforeend", `<label for="d">Transcript</label><input id="d" type="file">`);
    class FakeDataTransfer {
      files: File[] = [];
      items = { add: (f: File) => this.files.push(f) };
    }
    (globalThis as { DataTransfer?: unknown }).DataTransfer = FakeDataTransfer;
    let set: File[] = [];
    Object.defineProperty(document.getElementById("f")!, "files", { get: () => set, set: (v: File[]) => (set = v) });
    const p = { ...profile, documents: [{ type: "cv" as const, file_name: "CV.pdf", storage_path: "u/cv", is_default: true }] };
    await createEngine(document).fill({ profile: p, files: { cvFile: file("CV.pdf") }, cvExtras: [file("Transcript.pdf")], overwrite: false });
    expect(set.map((f) => f.name)).toEqual(["CV.pdf"]);
  });
});

describe("spørsmål pakket i mange lag (som «Andre spørsmål»)", () => {
  const question = (text: string, id: string) => `
    <div class="question">
      <div class="q-head"><div class="q-title"><span class="text">${text}</span><span class="req">*</span></div></div>
      <div class="q-body"><div class="field"><div class="wrap"><div class="inner"><div class="box">
        <textarea id="${id}" placeholder="Skriv inn et svar"></textarea>
      </div></div></div></div></div>
    </div>`;

  it("finner spørsmålsteksten og fyller ut", async () => {
    document.body.innerHTML = `
      <section><h2>Andre spørsmål *</h2>
        ${question("Kva stad/by er du student?", "q1")}
        ${question("Kva heiter studiestaden din? NTNU, HVL, UiB etc", "q2")}
        ${question("Kva heiter studiet ditt?", "q3")}
        ${question("Kva er din snittkarakter?", "q4")}
        ${question("Kor fekk du informasjon om campen?", "q5")}
      </section>`;
    const withEducation: FullProfile = {
      ...profile,
      educations: [{ school: "UiB", field_of_study: "Informatikk", location: "Bergen", grade: "B", sort_order: 0 }],
    };
    const report = await fillDocument({ profile: withEducation, files: {}, overwrite: false }, document);
    const v = (id: string) => (document.getElementById(id) as HTMLTextAreaElement).value;
    expect([v("q1"), v("q2"), v("q3"), v("q4")]).toEqual(["Bergen", "UiB", "Informatikk", "B"]);
    expect(v("q5")).toBe("");
    expect(report.unrecognized).toEqual(["Kor fekk du informasjon om campen?*"]);
  });
});

describe("gjentakende seksjoner (Workday «My Experience»)", () => {
  /** Lager en Workday-lignende side der «Add» legger til en blokk etter en kort forsinkelse. */
  function workdayPage() {
    document.body.innerHTML = `
      <h2>My Experience</h2>
      <div role="group" id="work"><h3>Work Experience</h3><div class="blocks"></div><button type="button" class="add">Add</button></div>
      <div role="group" id="edu"><h3>Education</h3><div class="blocks"></div><button type="button" class="add">Add</button></div>`;
    let n = 0;
    const field = (name: string, label: string, inner: string) =>
      `<div data-automation-id="formField-${name}"><label for="${name}-${n}">${label}</label>${inner}</div>`;
    const date = (name: string, label: string) =>
      `<div data-automation-id="formField-${name}"><div><label>${label}</label></div><div class="date">
         <input data-automation-id="dateSectionMonth-input" aria-label="Month" placeholder="MM">
         <input data-automation-id="dateSectionYear-input" aria-label="Year" placeholder="YYYY"></div></div>`;
    const yearOnly = (name: string, label: string) =>
      `<div data-automation-id="formField-${name}"><div><label>${label}</label></div><div class="date">
         <input data-automation-id="dateSectionYear-input" aria-label="Year" placeholder="YYYY"></div></div>`;
    const workBlock = () => `<div class="block"><h4>Work Experience ${n}</h4><button type="button">Delete</button>
        ${field("jobTitle", "Job Title*", `<input id="jobTitle-${n}">`)}
        ${field("companyName", "Company*", `<input id="companyName-${n}">`)}
        ${field("location", "Location", `<input id="location-${n}">`)}
        ${field("currentlyWorkHere", "I currently work here", `<input type="checkbox" id="currentlyWorkHere-${n}">`)}
        ${date("startDate", "From*")}${date("endDate", "To")}
        ${field("roleDescription", "Role Description", `<textarea id="roleDescription-${n}"></textarea>`)}
        <button type="button" aria-label="Add attachment">📎</button>
      </div>`;
    const eduBlock = () => `<div class="block"><h4>Education ${n}</h4><button type="button">Delete</button>
        ${field("schoolName", "School or University*", `<input id="schoolName-${n}">`)}
        ${field("degree", "Degree*", `<button type="button" aria-haspopup="listbox" id="degree-${n}">Select One</button>`)}
        ${field("fieldOfStudy", "Field of Study", `<input id="fieldOfStudy-${n}">`)}
        ${yearOnly("firstYearAttended", "From")}${yearOnly("lastYearAttended", "To (Actual or Expected)")}
      </div>`;
    for (const [id, make] of [["work", workBlock], ["edu", eduBlock]] as const) {
      const group = document.getElementById(id)!;
      group.querySelector(".add")!.addEventListener("click", () => {
        setTimeout(() => {
          n++;
          group.querySelector(".blocks")!.insertAdjacentHTML("beforeend", make());
          group.querySelector(".add")!.textContent = "Add Another";
          // Egendefinert nedtrekksliste for grad: åpner en liste med role="option".
          group.querySelectorAll<HTMLButtonElement>('[aria-haspopup="listbox"]').forEach((b) => {
            // Som Workday: åpner på mousedown, ikke på click.
            b.onmousedown = () => {
              document.querySelector("#listbox")?.remove();
              document.body.insertAdjacentHTML(
                "beforeend",
                `<ul id="listbox" role="listbox">${["Select One", "Bachelor of Arts (B.A.)", "Bachelor of Science (B.S.)", "Bachelor of Business (BBus)", "Master of Arts (M.A.)", "Master of Science (M.S.)", "Master of Business Administration (MBA)", "Juris Doctor (JD)"]
                  .map((o) => `<li role="option">${o}</li>`)
                  .join("")}</ul>`,
              );
              document.querySelectorAll<HTMLElement>("#listbox [role=option]").forEach((o) => {
                o.onclick = () => {
                  b.textContent = o.textContent;
                  document.querySelector("#listbox")?.remove();
                };
              });
            };
          });
        }, 50);
      });
    }
  }

  const withHistory: FullProfile = {
    ...profile,
    experiences: [
      { title: "UX-designer", employer: "Fjord AS", location: "Oslo", start_date: "2021-03-01", is_current: true, description: "Design av apper", sort_order: 0 },
      { title: "Butikkmedarbeider", employer: "Rema 1000", start_date: "2016-06-01", end_date: "2020-08-01", is_current: false, sort_order: 1 },
    ],
    educations: [
      // Pågående studium med forventet slutt.
      { school: "NTNU", degree: "Integrert master", field_of_study: "Informatikk", start_date: "2024-08-01", end_date: "2099-06-01", sort_order: 0 },
      // Ingen grad i profilen: nivået hentes fra fagfeltet.
      { school: "NHH", degree: null, field_of_study: "Bachelor i økonomi og administrasjon", sort_order: 1 },
    ],
  };

  it("klikker «Add» per oppføring og fyller hver blokk med sin oppføring", async () => {
    workdayPage();
    const report = await fillDocument({ profile: withHistory, files: {}, overwrite: false }, document);
    const v = (sel: string) => (document.querySelector(sel) as HTMLInputElement).value;
    const blocks = document.querySelectorAll("#work .block");
    expect(blocks).toHaveLength(2);

    expect(v("#jobTitle-1")).toBe("UX-designer");
    expect(v("#companyName-1")).toBe("Fjord AS");
    expect((document.querySelector("#currentlyWorkHere-1") as HTMLInputElement).checked).toBe(true);
    const [m1, y1, m1end, y1end] = Array.from(blocks[0]!.querySelectorAll<HTMLInputElement>(".date input")).map((i) => i.value);
    expect([m1, y1, m1end, y1end]).toEqual(["03", "2021", "", ""]); // pågående: ingen sluttdato
    expect(v("#roleDescription-1")).toBe("Design av apper");

    expect(v("#jobTitle-2")).toBe("Butikkmedarbeider");
    expect(v("#companyName-2")).toBe("Rema 1000");
    const dates2 = Array.from(blocks[1]!.querySelectorAll<HTMLInputElement>(".date input")).map((i) => i.value);
    expect(dates2).toEqual(["06", "2016", "08", "2020"]);

    expect(v("#schoolName-3")).toBe("NTNU");
    expect(document.querySelector("#degree-3")!.textContent).toBe("Master of Science (M.S.)");
    expect(v("#fieldOfStudy-3")).toBe("Informatikk");
    // Ingen «studerer fortsatt»-boks: «To (Actual or Expected)» får forventet sluttår.
    const eduYears = Array.from(document.querySelectorAll("#edu .block")[0]!.querySelectorAll<HTMLInputElement>(".date input")).map((i) => i.value);
    expect(eduYears).toEqual(["2024", "2099"]);
    expect(v("#schoolName-4")).toBe("NHH");
    expect(document.querySelector("#degree-4")!.textContent).toBe("Bachelor of Business (BBus)");

    const sections = report.fields.filter((f) => f.key === "experiences" || f.key === "educations");
    expect(sections.map((f) => [f.label, f.status])).toEqual([
      ["Arbeidserfaring (2 av 2)", "filled"],
      ["Utdanning (2 av 2)", "filled"],
    ]);
  });

  it("legger ikke til blokker en gang til når seksjonen allerede er fylt ut", async () => {
    workdayPage();
    await fillDocument({ profile: withHistory, files: {}, overwrite: false }, document);
    const report = await fillDocument({ profile: withHistory, files: {}, overwrite: false }, document);
    expect(document.querySelectorAll("#work .block")).toHaveLength(2);
    expect(report.fields.find((f) => f.key === "experiences")?.status).toBe("skipped-has-value");
  });
});

describe("«Add Another» som tegner hele seksjonen på nytt", () => {
  it("fyller den nye blokken, ikke de gamle som ble tegnet på nytt", async () => {
    document.body.innerHTML = `<div role="group"><h3>Work Experience</h3><div class="blocks"></div><button type="button" class="add">Add</button></div>`;
    const blocks = document.querySelector(".blocks")!;
    const button = document.querySelector<HTMLButtonElement>(".add")!;
    button.addEventListener("click", () => {
      setTimeout(() => {
        // Ta vare på verdiene, og tegn alle blokkene på nytt med nye elementer (som React ofte gjør).
        const saved = Array.from(blocks.querySelectorAll("input")).map((i) => i.value);
        const count = blocks.children.length + 1;
        blocks.innerHTML = Array.from({ length: count }, (_, i) =>
          `<div class="block"><label for="t${i}">Job Title</label><input id="t${i}"><label for="c${i}">Company</label><input id="c${i}"></div>`,
        ).join("");
        Array.from(blocks.querySelectorAll("input")).forEach((inp, i) => (inp.value = saved[i] ?? ""));
        button.textContent = "Add Another";
      }, 50);
    });
    const p: FullProfile = {
      ...profile,
      experiences: [
        { title: "A-tittel", employer: "A AS", is_current: false, sort_order: 0 },
        { title: "B-tittel", employer: "B AS", is_current: false, sort_order: 1 },
        { title: "C-tittel", employer: "C AS", is_current: false, sort_order: 2 },
      ],
    };
    const report = await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    const values = Array.from(blocks.querySelectorAll("input")).map((i) => i.value);
    expect(values).toEqual(["A-tittel", "A AS", "B-tittel", "B AS", "C-tittel", "C AS"]);
    expect(report.fields.find((f) => f.key === "experiences")?.label).toBe("Arbeidserfaring (3 av 3)");
  });
});

describe("språk-seksjon (Workday «Languages»)", () => {
  /** Nedtrekksliste som Workday sin: åpner på mousedown, valgt tekst vises i knappen. */
  function dropdown(id: string, options: string[]) {
    return `<button type="button" aria-haspopup="listbox" id="${id}" data-options="${options.join("|")}">Select One</button>`;
  }
  function wireDropdowns() {
    document.querySelectorAll<HTMLButtonElement>("[data-options]").forEach((b) => {
      b.onmousedown = () => {
        document.querySelector("#listbox")?.remove();
        const opts = ["Select One", ...b.dataset.options!.split("|")];
        document.body.insertAdjacentHTML("beforeend", `<ul id="listbox" role="listbox">${opts.map((o) => `<li role="option">${o}</li>`).join("")}</ul>`);
        document.querySelectorAll<HTMLElement>("#listbox [role=option]").forEach((o) => {
          o.onclick = () => {
            b.textContent = o.textContent;
            // Lukkes med en kort animasjon, som på Workday: listen er synlig en stund etter valget.
            const lb = document.querySelector("#listbox");
            lb?.removeAttribute("id");
            setTimeout(() => lb?.remove(), 300);
          };
        });
      };
    });
  }
  const LANGS = ["Danish", "English", "Norwegian", "Swedish"];
  const LEVELS = ["Beginner", "Intermediate", "Advanced", "Fluent", "Native"];
  const block = (n: number) => `
    <div class="block"><h4>Languages ${n}</h4>
      <div data-automation-id="formField-language"><label>Language*</label>${dropdown(`lang-${n}`, LANGS)}</div>
      <div><label for="fluent-${n}">I am fluent in this language.</label><input type="checkbox" id="fluent-${n}"></div>
      <div><label>Overall*</label>${dropdown(`level-${n}`, LEVELS)}</div>
    </div>`;

  it("fyller den tomme blokken, legger til flere og velger språk og nivå", async () => {
    document.body.innerHTML = `<div role="group"><h3>Languages</h3><div class="blocks">${block(1)}</div><button type="button" class="add">Add Another</button></div>`;
    wireDropdowns();
    let n = 1;
    document.querySelector(".add")!.addEventListener("click", () => {
      setTimeout(() => {
        n++;
        document.querySelector(".blocks")!.insertAdjacentHTML("beforeend", block(n));
        wireDropdowns();
      }, 50);
    });
    const p: FullProfile = {
      ...profile,
      languages: [
        { language: "Norsk", spoken_level: "native", written_level: "native", sort_order: 0 },
        { language: "Engelsk", spoken_level: "fluent", written_level: "conversational", sort_order: 1 },
        { language: "Tysk", spoken_level: "basic", written_level: null, sort_order: 2 },
      ],
    };
    const report = await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    const t = (id: string) => document.getElementById(id)!.textContent;
    const c = (id: string) => (document.getElementById(id) as HTMLInputElement).checked;
    expect([t("lang-1"), t("level-1"), c("fluent-1")]).toEqual(["Norwegian", "Native", true]);
    expect([t("lang-2"), t("level-2"), c("fluent-2")]).toEqual(["English", "Fluent", true]);
    // Tysk finnes ikke i listen: språket står tomt, men nivået fylles.
    expect([t("lang-3"), t("level-3"), c("fluent-3")]).toEqual(["Select One", "Beginner", false]);
    expect(report.fields.find((f) => f.key === "languages")?.label).toBe("Språk (3 av 3)");
  }, 20000);
});

describe("Websites-seksjon (Workday)", () => {
  it("legger til én blokk per lenke fra personalia, med https:// foran", async () => {
    document.body.innerHTML = `
      <div role="group"><h3>Websites</h3><p>Add any relevant websites.</p><div class="blocks"></div><button type="button" class="add">Add</button></div>`;
    let n = 0;
    const button = document.querySelector<HTMLButtonElement>(".add")!;
    button.addEventListener("click", () => {
      setTimeout(() => {
        n++;
        document.querySelector(".blocks")!.insertAdjacentHTML(
          "beforeend",
          `<div class="block"><h4>Websites ${n}</h4><button type="button">Delete</button>
             <div data-automation-id="formField-url"><label for="webAddress-${n}">URL*</label><input id="webAddress-${n}"></div></div>`,
        );
        button.textContent = "Add Another";
      }, 50);
    });
    const p: FullProfile = {
      ...profile,
      personal: { ...profile.personal, linkedin_url: "linkedin.com/in/julian", github_url: "https://github.com/jlrsource", website_url: null },
    };
    const report = await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    const urls = Array.from(document.querySelectorAll<HTMLInputElement>(".block input")).map((i) => i.value);
    expect(urls).toEqual(["https://linkedin.com/in/julian", "https://github.com/jlrsource"]);
    expect(report.fields.find((f) => f.key === "websites")?.label).toBe("Nettsider (2 av 2)");
  }, 15000);
});

describe("felt som valideres når de mister fokus (Workday «required»-feil)", () => {
  it("markerer feltene som besøkt selv om siden ikke har fokus", async () => {
    // Mens popupen er åpen har ikke siden fokus: el.focus()/blur() gjør ingenting.
    const realFocus = HTMLElement.prototype.focus;
    const realBlur = HTMLElement.prototype.blur;
    HTMLElement.prototype.focus = () => {};
    HTMLElement.prototype.blur = () => {};
    try {
      const committed: Record<string, string> = {};
      // Som Workday: verdien lagres i skjemaets modell først i onBlur.
      function Field({ id, label }: { id: string; label: string }) {
        const [value, setValue] = useState("");
        return createElement(
          "div",
          null,
          createElement("label", { htmlFor: id }, label),
          createElement("input", {
            id,
            value,
            onChange: (e: { target: { value: string } }) => setValue(e.target.value),
            onBlur: (e: { target: { value: string } }) => (committed[id] = e.target.value),
          }),
        );
      }
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      await act(async () =>
        root.render(createElement("form", null, createElement(Field, { id: "fn", label: "First Name" }), createElement(Field, { id: "em", label: "Email" }))),
      );
      await act(async () => {
        await fill();
      });
      expect(committed).toEqual({ fn: "Kari", em: "kari@example.no" });
      root.unmount();
    } finally {
      HTMLElement.prototype.focus = realFocus;
      HTMLElement.prototype.blur = realBlur;
    }
  });
});

describe("søkefelt som krever valg fra liste (Workday «Field of Study»)", () => {
  it("søker på engelsk navn, velger treffet, og lar ikke fritekst stå igjen", async () => {
    const SUBJECTS = ["Computer Engineering", "Computer Science", "Business Administration", "Economics"];
    document.body.innerHTML = `
      <div role="group"><h3>Education</h3>
        <div class="block"><h4>Education 1</h4>
          <div data-automation-id="formField-schoolName"><label for="school">School or University*</label><input id="school"></div>
          <div data-automation-id="formField-fieldOfStudy"><label for="fos">Field of Study</label>
            <div class="pills"></div><input id="fos"><span data-automation-id="promptIcon"></span></div>
        </div>
        <button type="button">Add Another</button>
      </div>`;
    const input = document.getElementById("fos") as HTMLInputElement;
    const pills = document.querySelector(".pills")!;
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      document.querySelector("#results")?.remove();
      const hits = SUBJECTS.filter((x) => x.toLowerCase().includes(input.value.toLowerCase()));
      const rows = hits.length ? hits.map((h) => `<li role="option">${h}</li>`).join("") : `<li role="option">No Items.</li>`;
      document.body.insertAdjacentHTML("beforeend", `<ul id="results" role="listbox">${rows}</ul>`);
      document.querySelectorAll<HTMLElement>("#results [role=option]").forEach((o) => {
        o.onclick = () => {
          pills.textContent = o.textContent;
          input.value = "";
          document.querySelector("#results")?.remove();
        };
      });
    });
    // Som Workday: fritekst som ikke er valgt fra listen, tømmes når feltet mister fokus.
    input.addEventListener("focusout", () => {
      input.value = "";
    });
    const p: FullProfile = { ...profile, educations: [{ school: "NTNU", degree: null, field_of_study: "Informatikk", sort_order: 0 }] };
    const report = await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    expect(pills.textContent).toBe("Computer Science");
    expect((document.getElementById("school") as HTMLInputElement).value).toBe("NTNU");
    expect(report.fields.find((f) => f.key === "educations")?.status).toBe("filled");
  }, 15000);
});

describe("AI-søkeord for fagfelt", () => {
  it("prøver søkeordene fra AI før den innebygde listen", async () => {
    const SUBJECTS = ["Social Work", "Child Development"];
    document.body.innerHTML = `
      <div role="group"><h3>Education</h3>
        <div class="block"><h4>Education 1</h4>
          <div data-automation-id="formField-fieldOfStudy"><label for="fos">Field of Study</label>
            <div class="pills"></div><input id="fos"><span data-automation-id="promptIcon"></span></div>
        </div>
        <button type="button">Add Another</button>
      </div>`;
    const input = document.getElementById("fos") as HTMLInputElement;
    const pills = document.querySelector(".pills")!;
    const searched: string[] = [];
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      searched.push(input.value);
      document.querySelector("#results")?.remove();
      const hits = SUBJECTS.filter((x) => x.toLowerCase().includes(input.value.toLowerCase()));
      const rows = hits.length ? hits.map((h) => `<li role="option">${h}</li>`).join("") : `<li role="option">No Items.</li>`;
      document.body.insertAdjacentHTML("beforeend", `<ul id="results" role="listbox">${rows}</ul>`);
      document.querySelectorAll<HTMLElement>("#results [role=option]").forEach((o) => {
        o.onclick = () => {
          pills.textContent = o.textContent;
          document.querySelector("#results")?.remove();
        };
      });
    });
    // «Barnevern» står ikke i den innebygde listen; AI har oversatt det.
    const p: FullProfile = {
      ...profile,
      educations: [{ school: "OsloMet", field_of_study: "Barnevern", field_of_study_en: ["Child Welfare", "Social Work"], sort_order: 0 }],
    };
    await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    expect(pills.textContent).toBe("Social Work");
    expect(searched).toEqual(["Child Welfare", "Social Work"]);
  }, 15000);
});

describe("treff der klikket må treffe et element inni raden (Workday-søk)", () => {
  it("velger treffet slik at det blir stående i feltet", async () => {
    document.body.innerHTML = `
      <div role="group"><h3>Education</h3>
        <div class="block"><h4>Education 1</h4>
          <div data-automation-id="formField-fieldOfStudy"><label for="fos">Field of Study</label>
            <div class="pills"></div><input id="fos"><span data-automation-id="promptIcon"></span></div>
        </div>
        <button type="button">Add Another</button>
      </div>`;
    const input = document.getElementById("fos") as HTMLInputElement;
    const pills = document.querySelector(".pills")!;
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !input.value) return;
      document.querySelector("#results")?.remove();
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="results"><div role="option"><div data-automation-id="promptOption"><span>Engineering</span></div></div></div>`,
      );
      const results = document.getElementById("results")!;
      const wire = () => {
        // Klikk på raden selv gjør ingenting: bare det indre elementet velger.
        const node = results.querySelector<HTMLElement>('[data-automation-id="promptOption"]')!;
        node.addEventListener("click", () => {
          if (!node.isConnected) return; // som React: gamle elementer reagerer ikke
          pills.textContent = "Engineering";
          input.value = "";
          results.remove();
        });
      };
      wire();
      // Som Workday: hover tegner raden på nytt (ny node), men velger ikke.
      results.addEventListener("mouseover", () => {
        if (results.dataset.hovered) return;
        results.dataset.hovered = "1";
        results.innerHTML = results.innerHTML;
        wire();
      });
    });
    const p: FullProfile = {
      ...profile,
      educations: [{ school: "UiB", field_of_study: "Ingeniørvitenskap og IKT", field_of_study_en: ["Engineering"], sort_order: 0 }],
    };
    const report = await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    expect(pills.textContent).toBe("Engineering");
    expect(report.fields.find((f) => f.key === "educations")?.status).toBe("filled");
  }, 15000);
});

describe("søkeliste der bare tastaturet velger (som Workday)", () => {
  it("piler ned til riktig rad i rolig tempo og velger med Enter", async () => {
    const SUBJECTS = ["Aerospace Engineering", "Chemical Engineering", "Civil Engineering", "Engineering", "Industrial Engineering"];
    document.body.innerHTML = `
      <div role="group"><h3>Education</h3>
        <div class="block"><h4>Education 1</h4>
          <div data-automation-id="formField-fieldOfStudy"><label for="fos">Field of Study</label>
            <div class="pills"></div><input id="fos"><span data-automation-id="promptIcon"></span></div>
        </div>
        <button type="button">Add Another</button>
      </div>`;
    const input = document.getElementById("fos") as HTMLInputElement;
    const pills = document.querySelector(".pills")!;
    let active = -1;
    let lastKey = 0;
    const rows = () => Array.from(document.querySelectorAll<HTMLElement>("#results [role=option]"));
    input.addEventListener("keydown", (e) => {
      const now = Date.now();
      if (e.key === "ArrowDown") {
        // Trykk som kommer tettere enn 100 ms blir slått sammen (som React-batching i Workday).
        if (now - lastKey < 100) return;
        lastKey = now;
        active = Math.min(active + 1, rows().length - 1);
        rows().forEach((r, i) => r.setAttribute("aria-selected", String(i === active)));
        return;
      }
      if (e.key !== "Enter") return;
      if (active >= 0 && document.querySelector("#results")) {
        pills.textContent = rows()[active]!.textContent;
        input.value = "";
        document.querySelector("#results")?.remove();
        return;
      }
      if (!input.value) return;
      document.querySelector("#results")?.remove();
      active = -1;
      const hits = SUBJECTS.filter((x) => x.toLowerCase().includes(input.value.toLowerCase()));
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div id="results">${hits.map((h) => `<div role="option" aria-selected="false"><span class="radio"></span>${h}</div>`).join("")}</div>`,
      );
    });
    const p: FullProfile = {
      ...profile,
      educations: [{ school: "UiB", field_of_study: "Ingeniørvitenskap og IKT", field_of_study_en: ["Engineering"], sort_order: 0 }],
    };
    await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    expect(pills.textContent).toBe("Engineering");
  }, 20000);
});

describe("Workday-treffrad: radioknapp og tekst er søsken (fra Inspiser 20. okt)", () => {
  it("klikker radioknappen ved siden av teksten, ikke bare teksten", async () => {
    const SUBJECTS = ["Aerospace Engineering", "Civil Engineering", "Engineering", "Industrial Engineering"];
    document.body.innerHTML = `
      <div role="group"><h3>Education</h3>
        <div class="block"><h4>Education 1</h4>
          <div data-automation-id="formField-fieldOfStudy"><label for="fos">Field of Study</label>
            <div class="pills"></div><input id="fos"><span data-automation-id="promptIcon"></span>
            <div class="popup"></div></div>
        </div>
        <button type="button">Add Another</button>
      </div>`;
    const input = document.getElementById("fos") as HTMLInputElement;
    const pills = document.querySelector(".pills")!;
    const popup = document.querySelector(".popup")!; // listen ligger inni feltet
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || !input.value) return;
      const hits = SUBJECTS.filter((x) => x.toLowerCase().includes(input.value.toLowerCase()));
      popup.innerHTML = hits
        .map(
          (h, i) => `<div class="row">
            <div class="css-s77mpk"><input type="radio" name="fos-radio" id="r${i}"></div>
            <div id="promptOption-${i}" data-automation-id="promptOption" data-automation-label="${h}">${h}</div>
          </div>`,
        )
        .join("");
      // Bare radioknappen velger (håndteringen sitter der, ikke på teksten eller raden).
      popup.querySelectorAll<HTMLInputElement>("input[type=radio]").forEach((r, i) => {
        r.addEventListener("click", () => {
          pills.innerHTML = `<div data-automation-id="selectedItem">${hits[i]}</div>`;
          popup.innerHTML = "";
          input.value = "";
        });
      });
    });
    const p: FullProfile = {
      ...profile,
      educations: [{ school: "UiB", field_of_study: "Ingeniørvitenskap og IKT", field_of_study_en: ["Engineering"], sort_order: 0 }],
    };
    await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    expect(pills.textContent).toBe("Engineering");
  }, 20000);
});

describe("norske skjemaer: dato i tre lister, års erfaring, innlogging, dansk plassholder", () => {
  const months = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];
  it("fyller år, måned og dag i hver sin liste", async () => {
    document.body.innerHTML = `
      <div><label for="y">Fødselsdato</label>
        <span><select id="y"><option value="">År</option>${Array.from({ length: 80 }, (_, i) => `<option>${2010 - i}</option>`).join("")}</select>
        <select id="m" aria-label="Måned"><option value="">Måned</option>${months.map((n, i) => `<option value="${i + 1}">${n}</option>`).join("")}</select>
        <select id="d" aria-label="Dag"><option value="">Dag</option>${Array.from({ length: 31 }, (_, i) => `<option>${i + 1}</option>`).join("")}</select></span>
      </div>`;
    await fill();
    const v = (id: string) => (document.getElementById(id) as HTMLSelectElement).selectedOptions[0]!.text;
    expect([v("y"), v("m"), v("d")]).toEqual(["1995", "april", "17"]);
  });

  it("regner ut års erfaring og velger riktig intervall", async () => {
    const p: FullProfile = {
      ...profile,
      experiences: [{ employer: "A", title: "x", start_date: "2020-01-01", end_date: "2024-06-01", is_current: false, sort_order: 0 }],
    };
    document.body.innerHTML = `<label for="a">Hvor mange års relevant erfaring har du?*</label><input id="a">`;
    await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    expect((document.getElementById("a") as HTMLInputElement).value).toBe("4");
    document.body.innerHTML = `<label for="b">Years of experience</label><select id="b"><option value="">Velg</option><option>0-2</option><option>3-5</option><option>6-10</option><option>10+</option></select>`;
    await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    expect((document.getElementById("b") as HTMLSelectElement).selectedOptions[0]!.text).toBe("3-5");
  });

  it("rører ikke innloggingsbokser", async () => {
    document.body.innerHTML = `
      <div class="login"><label for="le">E-mail</label><input id="le"><label for="pw">Password</label><input id="pw" type="password"><button>Log ind</button></div>
      <form><label for="e">E-post</label><input id="e"><label for="f">Fornavn</label><input id="f"><label for="l">Etternavn</label><input id="l"></form>`;
    await fill();
    expect((document.getElementById("le") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("e") as HTMLInputElement).value).toBe("kari@example.no");
  });

  it("forstår dansk «Vælg» som tom liste", async () => {
    document.body.innerHTML = `<label for="c">Land</label><select id="c"><option value="0">Vælg</option><option value="45">Danmark</option><option value="47">Norge</option></select>`;
    await fill();
    expect((document.getElementById("c") as HTMLSelectElement).value).toBe("47");
  });

  it("fyller på nytt når siden tømmer et felt etterpå (By fra postnummer)", async () => {
    document.body.innerHTML = `<label for="z">Postnr.</label><input id="z" autocomplete="postal-code"><label for="c">By</label><input id="c" autocomplete="address-level2">`;
    const zip = document.getElementById("z") as HTMLInputElement;
    const city = document.getElementById("c") as HTMLInputElement;
    // Som HR-manager: slår opp byen fra postnummeret når feltet mister fokus, og tømmer den hvis ukjent.
    zip.addEventListener("focusout", () => setTimeout(() => (city.value = ""), 100));
    await fill();
    expect(city.value).toBe("Oslo");
  });
});

describe("landskode-lister for telefon", () => {
  it.each([
    [["AC +247", "AD +376", "NO +47", "SJ +47"], "NO +47"],
    [["Velg", "Norway (+47)", "Sweden (+46)"], "Norway (+47)"],
    [["+46 Sverige", "+47 Norge", "+45 Danmark"], "+47 Norge"],
  ])("%j → %s", async (options, expected) => {
    document.body.innerHTML = `<label for="c">Land</label><select id="c">${options.map((o) => `<option>${o}</option>`).join("")}</select>`;
    await fill(true);
    expect((document.getElementById("c") as HTMLSelectElement).selectedOptions[0]!.text).toBe(expected);
  });
});

it("landskode-liste ved telefonnummeret tolkes som land, ikke telefon (Finn)", async () => {
  document.body.innerHTML = `
    <div><label for="t">Telefonnummer</label>
      <select id="c" aria-label="land"><option>AC +247</option><option>AD +376</option><option>AE +971</option><option>NO +47</option><option>SE +46</option></select>
      <input id="t" type="tel"></div>`;
  await fill();
  expect((document.getElementById("c") as HTMLSelectElement).selectedOptions[0]!.text).toBe("NO +47");
  expect((document.getElementById("t") as HTMLInputElement).value).toBe("+47 900 00 000");
});

describe("Jobbnorge-mønster: redigeringsboks med «Lagre», én om gangen", () => {
  const MONTHS = ["Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"];
  const monthSelect = (id: string) => `<select id="${id}">${MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select>`;
  let n = 0;
  const editors: Record<string, () => string> = {
    utdanning: () => `
      <fieldset><legend>Hva har du studert?</legend>
        <label for="sr${n}">Studieretning</label><input id="sr${n}">
        <label for="ui${n}">Utdanningsinstitusjon *</label><input id="ui${n}">
        <label><input type="checkbox" id="fb${n}"> Har fagbrev</label>
        <label for="sp${n}">Studiepoeng / Vekttall</label><input id="sp${n}">
        <label for="gr${n}">Grad</label><input id="gr${n}">
      </fieldset>
      <fieldset><legend>Når gjennomførte du studiet?</legend>
        <label><input type="checkbox" id="fu${n}"> Er fortsatt under utdanning</label>
        <div><label for="fm${n}">Fra Måned</label>${monthSelect(`fm${n}`)}<label for="fa${n}">Fra År *</label><input id="fa${n}"></div>
        <div><label for="tm${n}">Til Måned</label>${monthSelect(`tm${n}`)}<label for="ta${n}">Til År *</label><input id="ta${n}"></div>
      </fieldset>`,
    yrkeserfaring: () => `
      <fieldset><legend>Hvor har du jobbet?</legend>
        <label for="ag${n}">Arbeidsgiver *</label><input id="ag${n}">
        <label for="st${n}">Stilling *</label><input id="st${n}">
        <label for="pr${n}">Stillingsprosent</label><input id="pr${n}" type="number">
      </fieldset>
      <fieldset><legend>Når jobbet du i denne stillingen?</legend>
        <label><input type="checkbox" id="fa_${n}"> Fortsatt ansatt</label>
        <div><label for="wfm${n}">Fra Måned</label>${monthSelect(`wfm${n}`)}<label for="wfa${n}">Fra År *</label><input id="wfa${n}"></div>
        <div><label for="wtm${n}">Til Måned</label>${monthSelect(`wtm${n}`)}<label for="wta${n}">Til År *</label><input id="wta${n}"></div>
      </fieldset>`,
    språk: () => `
      <fieldset><legend>Hvilket språk vil du legge til på CVen?</legend>
        <label for="sl${n}">Språk *</label><select id="sl${n}"><option value="">Velg</option><option>Engelsk</option><option>Norsk - bokmål</option></select>
      </fieldset>
      <fieldset><legend>Hvor godt behersker du språket?</legend>
        <div class="q"><p>Skriftlig</p>${["Morsmål", "Flytende", "Gode kunnskaper", "Grunnleggende kunnskaper"].map((o, i) => `<label><input type="radio" name="w${n}" value="${i}"> ${o}</label>`).join("")}</div>
        <div class="q"><p>Muntlig</p>${["Morsmål", "Flytende", "Gode kunnskaper", "Grunnleggende kunnskaper"].map((o, i) => `<label><input type="radio" name="s${n}" value="${i}"> ${o}</label>`).join("")}</div>
      </fieldset>`,
    referanser: () => `
      <fieldset><legend>Hvem vil du legge til som referanse?</legend>
        <label for="rn${n}">Fullt navn *</label><input id="rn${n}">
        <label for="rf${n}">Firma *</label><input id="rf${n}">
        <label for="rt${n}">Tittel/rolle *</label><input id="rt${n}">
      </fieldset>
      <fieldset><legend>Kontaktinformasjon</legend>
        <label for="re${n}">E-post</label><input id="re${n}">
        <label for="rm${n}">Mobiltelefon *</label><input id="rm${n}">
      </fieldset>`,
  };
  const section = (title: string) => `
    <section data-s="${title.toLowerCase()}">
      <div class="head"><h1>${title}</h1><button type="button" class="add">Legg til</button></div>
      <div class="saved"></div><div class="editor"></div>
    </section>`;

  function jobbnorgePage() {
    document.body.innerHTML = `
      <h1>Personalia</h1><label for="pf">Fornavn</label><input id="pf" value="Kari">
      ${section("Utdanning")}${section("Yrkeserfaring")}${section("Språk")}${section("Referanser")}${section("Linker")}`;
    document.querySelectorAll<HTMLElement>("section").forEach((sec) => {
      const editor = sec.querySelector<HTMLElement>(".editor")!;
      sec.querySelector(".add")!.addEventListener("click", () => {
        if (document.querySelector(".editor form")) return; // bare én åpen redigeringsboks om gangen
        n++;
        setTimeout(() => {
          editor.innerHTML = `<form>${editors[sec.dataset.s!]?.() ?? ""}<button type="button" class="cancel">Avbryt</button><button type="button" class="save">Lagre</button></form>`;
          editor.querySelector(".save")!.addEventListener("click", () => {
            const values = Array.from(editor.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=checkbox]):not([type=radio]), select")).map((i) => i.value);
            editor.querySelectorAll<HTMLInputElement>("input[type=radio]:checked").forEach((r) => values.push(r.parentElement!.textContent!.trim()));
            sec.querySelector(".saved")!.insertAdjacentHTML("beforeend", `<div class="card">${values.join(" | ")}</div>`);
            editor.innerHTML = "";
          });
        }, 50);
      });
    });
  }

  it("legger til, fyller og lagrer hver oppføring, og fyller referanser med referansen (ikke brukeren)", async () => {
    jobbnorgePage();
    const p: FullProfile = {
      ...profile,
      experiences: [
        { employer: "Bærum kommune", title: "Assistent", start_date: "2025-01-01", end_date: "2025-06-01", is_current: false, sort_order: 0 },
        { employer: "Rema 1000", title: "Butikkmedarbeider", start_date: "2022-08-01", end_date: "2024-12-01", is_current: false, employment_percentage: 40, sort_order: 1 },
      ],
      educations: [{ school: "NTNU", degree: "Integrert master", field_of_study: "Ingeniørvitenskap & IKT", start_date: "2024-08-01", end_date: "2029-06-01", sort_order: 0 }],
      languages: [{ language: "Engelsk", spoken_level: "fluent", written_level: "conversational", sort_order: 0 }],
      references: [{ name: "Ola Leder", company: "Bærum kommune", role: "Rektor", email: "ola@example.no", phone: "+47 400 00 000", sort_order: 0 }],
    };
    const report = await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    const cards = (s: string) => Array.from(document.querySelectorAll(`section[data-s="${s}"] .card`)).map((c) => c.textContent);

    expect(cards("yrkeserfaring")).toEqual(["Bærum kommune | Assistent | 100 | 1 | 2025 | 6 | 2025", "Rema 1000 | Butikkmedarbeider | 40 | 8 | 2022 | 12 | 2024"]);
    // Pågående studium: Til-feltene står tomme (standardmåned «Januar» = 1).
    expect(cards("utdanning")).toEqual([expect.stringMatching(/^Ingeniørvitenskap & IKT \| NTNU \| \d+ \| Integrert master \| 8 \| 2024 \| 1 \| $/)]);
    // Skriftlig «godt» → Gode kunnskaper, muntlig «flytende» → Flytende.
    expect(cards("språk")).toEqual(["Engelsk | Gode kunnskaper | Flytende"]);
    expect(cards("referanser")).toEqual(["Ola Leder | Bærum kommune | Rektor | ola@example.no | +47 400 00 000"]);
    const labels = report.fields.filter((f) => ["experiences", "educations", "languages", "references"].includes(f.key)).map((f) => f.label);
    expect(labels).toEqual(["Utdanning (1 av 1)", "Arbeidserfaring (2 av 2)", "Språk (1 av 1)", "Referanser (1 av 1)"]);
  }, 30000);

  it("fyller aldri referanse-felt med brukerens egne opplysninger", async () => {
    jobbnorgePage();
    // Åpne referanseboksen manuelt (som brukeren kan ha gjort), uten referanser i profilen.
    (document.querySelector('section[data-s="referanser"] .add') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 100));
    await fillDocument({ profile: { ...profile, references: [] }, files: {}, overwrite: false }, document);
    const ref = Array.from(document.querySelectorAll<HTMLInputElement>('section[data-s="referanser"] .editor input')).map((i) => i.value);
    expect(ref.every((v) => v === "")).toBe(true);
    // Åpen referanseboks blokkerer «Legg til» i de andre seksjonene, så extensionen venter en stund på hver.
  }, 60000);
});

describe("Jobbnorge med web-komponenter (Lit) og Vue-modell (fra lagret side 23. okt)", () => {
  // Modellen appen lagrer fra. Den oppdateres bare av hendelser som krysser shadow DOM (composed).
  let model: Record<string, string | boolean> = {};

  function defineComponents() {
    if (customElements.get("jn-input")) return;
    class JnInput extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        const root = this.attachShadow({ mode: "open" });
        const type = this.tagName === "JN-NUMBERINPUT" ? "number" : "text";
        root.innerHTML = `<label for="i">${this.getAttribute("labeltext")}</label><input id="i" type="${type}">`;
        // Som Jobbnorge: årsfeltene er forhåndsutfylt med inneværende år.
        if (/ år$/.test(this.getAttribute("labeltext") ?? "")) root.querySelector("input")!.value = String(new Date().getFullYear());
        // Som Vue: lytter på komponenten (verten). Når bare hendelser som krysser shadow DOM hit.
        this.addEventListener("input", (e) => (model[this.getAttribute("labeltext")!] = (e.composedPath()[0] as HTMLInputElement).value));
      }
    }
    class JnNumber extends JnInput {}
    class JnCheckbox extends HTMLElement {
      connectedCallback() {
        if (this.shadowRoot) return;
        const root = this.attachShadow({ mode: "open" });
        root.innerHTML = `<label for="c">${this.getAttribute("labeltext")}</label><input id="c" type="checkbox">`;
        const box = root.querySelector("input")!;
        box.addEventListener("change", () => this.dispatchEvent(new CustomEvent("jn-change", { bubbles: true, composed: true })));
        this.addEventListener("jn-change", () => (model[this.getAttribute("labeltext")!] = box.checked));
      }
    }
    customElements.define("jn-input", JnInput);
    customElements.define("jn-numberinput", JnNumber);
    customElements.define("jn-checkbox", JnCheckbox);
  }

  const months = ["Januar", "Februar", "Mars", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Desember"];
  const menu = (label: string) =>
    `<div><label>${label}</label><div role="menu" aria-label="${label}" button-text="Oktober" data-menu="${label}">${months
      .map((m, i) => `<div id="${i}" role="menuitem"${m === "Oktober" ? " selected" : ""}>${m}</div>`)
      .join("")}</div></div>`;

  it("finner feltene inni komponentene, og verdiene havner i appens modell før «Lagre»", async () => {
    defineComponents();
    model = {};
    document.body.innerHTML = `
      <div id="educationSection"><div class="heading-with-help-icon"><h1>Utdanning</h1></div>
        <button type="button" class="add">Legg til</button><div class="saved"></div><div class="editor"></div></div>
      <div id="workSection"><h1>Yrkeserfaring</h1><button type="button">Legg til</button></div>`;
    const editor = document.querySelector(".editor")!;
    document.querySelector(".add")!.addEventListener("click", () => {
      setTimeout(() => {
        editor.innerHTML = `<form class="edit">
          <fieldset><legend>Hva har du studert?</legend>
            <jn-input labeltext="Studieretning"></jn-input><jn-input labeltext="Utdanningsinstitusjon "></jn-input>
            <jn-checkbox labeltext="Har fagbrev"></jn-checkbox>
            <jn-numberinput labeltext="Studiepoeng / vekttall"></jn-numberinput><jn-input labeltext="Grad"></jn-input></fieldset>
          <fieldset><legend>Når gjennomførte du studiet?</legend>
            <jn-checkbox labeltext="Er fortsatt under utdanning"></jn-checkbox>
            <div class="input-grid">${menu("Fra måned")}<jn-numberinput labeltext="Fra år"></jn-numberinput></div>
            <div class="input-grid">${menu("Til måned")}<jn-numberinput labeltext="Til år"></jn-numberinput></div></fieldset>
          <button type="button">Avbryt</button><button type="button" class="save">Lagre</button></form>`;
        editor.querySelectorAll<HTMLElement>("[role=menuitem]").forEach((item) =>
          item.addEventListener("click", () => {
            const m = item.parentElement!;
            m.querySelectorAll("[role=menuitem]").forEach((x) => x.removeAttribute("selected"));
            item.setAttribute("selected", "");
            m.setAttribute("button-text", item.textContent!);
            model[m.getAttribute("aria-label")!] = item.textContent!;
          }),
        );
        editor.querySelector(".save")!.addEventListener("click", () => {
          document.querySelector(".saved")!.textContent = JSON.stringify(model);
          editor.innerHTML = "";
        });
      }, 50);
    });

    const p: FullProfile = {
      ...profile,
      educations: [{ school: "NTNU", degree: "Integrert master", field_of_study: "Ingeniørvitenskap & IKT", start_date: "2024-08-01", end_date: "2029-06-01", sort_order: 0 }],
    };
    const report = await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    const saved = JSON.parse(document.querySelector(".saved")!.textContent || "{}");
    expect(saved).toMatchObject({
      Studieretning: "Ingeniørvitenskap & IKT",
      "Utdanningsinstitusjon ": "NTNU",
      Grad: "Integrert master",
      "Er fortsatt under utdanning": true,
      "Fra måned": "August",
      "Fra år": "2024",
    });
    expect(saved["Studiepoeng / vekttall"]).toMatch(/^\d+$/);
    expect(saved["Har fagbrev"]).toBeUndefined();
    expect(saved["Til år"]).toBeUndefined(); // pågående studium
    expect(report.fields.find((f) => f.key === "educations")?.label).toBe("Utdanning (1 av 1)");
  }, 20000);
});

describe("Jobbnorge: lagrede oppføringer, lenkebeskrivelse", () => {
  it("legger bare til språk som mangler, selv om en lagret oppføring har egen overskrift", async () => {
    document.body.innerHTML = `
      <section><h1>Språk</h1>
        <div class="saved"><button>Rediger</button><h2>Norsk - bokmål</h2><p>Muntlig: Morsmål, Skriftlig: Morsmål</p></div>
        <button type="button" class="add">Legg til</button><div class="editor"></div></section>
      <section><h1>Referanser</h1></section>`;
    const editor = document.querySelector(".editor")!;
    document.querySelector(".add")!.addEventListener("click", () => {
      setTimeout(() => {
        editor.innerHTML = `<form><label for="l">Språk *</label><select id="l"><option value="">Velg</option><option>Engelsk</option><option>Norsk - bokmål</option></select>
          <button type="button">Avbryt</button><button type="button" class="save">Lagre</button></form>`;
        editor.querySelector(".save")!.addEventListener("click", () => {
          document.querySelector(".saved")!.insertAdjacentHTML("beforeend", `<h2>${(editor.querySelector("select") as HTMLSelectElement).value}</h2>`);
          editor.innerHTML = "";
        });
      }, 50);
    });
    const p: FullProfile = {
      ...profile,
      languages: [
        { language: "Norsk", spoken_level: "native", written_level: "native", sort_order: 0 },
        { language: "Engelsk", spoken_level: "fluent", written_level: "fluent", sort_order: 1 },
      ],
    };
    const report = await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    expect(Array.from(document.querySelectorAll(".saved h2")).map((h) => h.textContent)).toEqual(["Norsk - bokmål", "Engelsk"]);
    expect(report.fields.find((f) => f.key === "languages")?.label).toBe("Språk (1 av 1)");
  }, 20000);

  it("skriver «LinkedIn» i lenkebeskrivelsen og URL-en bare i URL-feltet", async () => {
    document.body.innerHTML = `
      <section><h1>Linker</h1><button type="button" class="add">Legg til</button><div class="editor"></div><div class="saved"></div></section>`;
    const editor = document.querySelector(".editor")!;
    document.querySelector(".add")!.addEventListener("click", () => {
      setTimeout(() => {
        editor.innerHTML = `<form><fieldset><legend>Legg til lenke</legend>
          <label for="u">Nettstedadresse (URL) *</label><input id="u">
          <textarea id="d" placeholder="Hva handler lenken om?"></textarea></fieldset>
          <button type="button">Avbryt</button><button type="button" class="save">Lagre</button></form>`;
        editor.querySelector(".save")!.addEventListener("click", () => {
          const u = (editor.querySelector("#u") as HTMLInputElement).value;
          const d = (editor.querySelector("#d") as HTMLTextAreaElement).value;
          document.querySelector(".saved")!.insertAdjacentHTML("beforeend", `<p>${u} | ${d}</p>`);
          editor.innerHTML = "";
        });
      }, 50);
    });
    const p: FullProfile = { ...profile, personal: { ...profile.personal, linkedin_url: "https://linkedin.com/in/kari", github_url: null, website_url: null } };
    await fillDocument({ profile: p, files: {}, overwrite: false }, document);
    expect(Array.from(document.querySelectorAll(".saved p")).map((x) => x.textContent)).toEqual(["https://linkedin.com/in/kari | LinkedIn"]);
  }, 20000);
});

describe("SuccessFactors: filfeltet dukker først opp etter klikk på «+» (fra lagret side 26. okt)", () => {
  const file = (name: string) => ({ name, mime: "application/pdf", base64: btoa("pdf") });
  function successFactorsPage() {
    const field = (id: string, label: string, text: string) => `
      <div class="RCMFormField rcmFormElement attachmentField rowBreak"><label class="rcmFormFieldLabel">${label}</label>
        <div id="${id}:_attachWrapper"><div id="${id}:_attach" class="attachmentBtn">
          <div id="${id}:_attachLabel"><span>${text}</span></div>
          <div role="button" id="${id}:_attachDownloadLabel" class="displayNone"><span id="${id}:_link"></span></div>
          <span id="${id}:_attachIcon" class="glyphicon glyphicon-plus-sign addAttachments"></span>
          <div id="${id}:_attachForm" class="displayNone"></div>
        </div></div>
      </div>`;
    document.documentElement.lang = "nb-NO";
    document.body.innerHTML = `<h2>Mine dokumenter</h2>${field("46", "CV", "Last opp en CV")}${field("48", "Øvrig dokumentasjon", "Legg til et dokument")}`;
    const uploads: string[] = [];
    let popup = 0;
    document.querySelectorAll<HTMLElement>(".addAttachments").forEach((icon) => {
      const id = icon.id.split(":")[0];
      icon.onclick = () => {
        // Som SuccessFactors: en boks med «Last opp fra enhet», og bare én om gangen.
        document.querySelector(".callout")?.remove();
        popup++;
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div class="callout" role="dialog"><span id="p${popup}_uploadComputer">Last opp fra enhet</span><input type="file" id="p${popup}_file" class="fileUpload" aria-labelledby="p${popup}_uploadComputer"></div>`,
        );
        const input = document.getElementById(`p${popup}_file`) as HTMLInputElement;
        input.onchange = () => {
          const name = (input.files as unknown as File[])[0]!.name;
          document.querySelector(".callout")?.remove();
          setTimeout(() => {
            uploads.push(`${id}:${name}`);
            document.getElementById(`${id}:_link`)!.textContent = name;
            document.getElementById(`${id}:_attachDownloadLabel`)!.classList.remove("displayNone");
          }, 100);
        };
      };
    });
    return uploads;
  }

  it("ber om CV og karakterutskrift, klikker «+» og laster opp én fil i hvert felt", async () => {
    const uploads = successFactorsPage();
    class FakeDataTransfer {
      files: File[] = [];
      items = { add: (f: File) => this.files.push(f) };
    }
    (globalThis as { DataTransfer?: unknown }).DataTransfer = FakeDataTransfer;
    // jsdom lar ikke input.files settes, så la hvert nye filfelt ta imot filer.
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")!;
    const store = new WeakMap<HTMLInputElement, File[]>();
    Object.defineProperty(HTMLInputElement.prototype, "files", {
      configurable: true,
      get(this: HTMLInputElement) {
        return store.get(this) ?? [];
      },
      set(this: HTMLInputElement, v: File[]) {
        store.set(this, v);
      },
    });
    try {
      const engine = createEngine(document);
      const { keys, lang } = engine.analyze();
      expect(keys).toEqual(expect.arrayContaining(["cvFile", "diplomaFile"]));
      expect(lang).toBe("no");
      const report = await engine.fill({
        profile,
        files: { cvFile: file("CV.pdf"), diplomaFile: file("Karakterutskrift.pdf") },
        overwrite: false,
      });
      expect(uploads).toEqual(["46:CV.pdf", "48:Karakterutskrift.pdf"]);
      const files = report.fields.filter((f) => f.key === "cvFile" || f.key === "diplomaFile");
      expect(files.map((f) => [f.label, f.status])).toEqual([
        ["CV (fil): CV.pdf", "filled"],
        ["Vitnemål (fil): Karakterutskrift.pdf", "filled"],
      ]);

      // Andre gang: allerede lastet opp, så ingenting nytt.
      await engine.fill({ profile, files: { cvFile: file("CV.pdf"), diplomaFile: file("Karakterutskrift.pdf") }, overwrite: false });
      expect(uploads).toHaveLength(2);
    } finally {
      Object.defineProperty(HTMLInputElement.prototype, "files", desc);
    }
  }, 30000);
});
