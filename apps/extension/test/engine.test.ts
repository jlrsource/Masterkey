import { emptyProfile, type FullProfile } from "@soknadsprofil/shared";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { classifyDocument, fillDocument } from "@/lib/engine/engine";

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
      { school: "NTNU", degree: "Integrert master", field_of_study: "Informatikk", sort_order: 0 },
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
