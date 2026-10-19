"use client";

import { certificationSchema, educationSchema, experienceSchema, volunteeringSchema } from "@soknadsprofil/shared";
import { ListSection } from "@/components/app/list-section";
import { LoadingBlock, PageHeader } from "@/components/app/page-header";
import { useProfile } from "@/lib/profile-store";
import { formatMonth, formatPeriod } from "@/lib/utils";

type R = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const period = (r: R) => formatPeriod(s(r.start_date), s(r.end_date), Boolean(r.is_current)) || undefined;

export default function ErfaringPage() {
  const { loading } = useProfile();
  if (loading) return <LoadingBlock />;

  return (
    <div>
      <PageHeader title="Erfaring og utdanning" description="Arbeid, verv, utdanning og kurs. Dra kortene for å bestemme rekkefølgen. Øverst vises først." />
      <div className="space-y-12">
        <ListSection
          table="experiences"
          schema={experienceSchema}
          heading="Arbeidserfaring"
          addLabel="Legg til jobb"
          emptyText="Ingen jobber ennå. Klikk her for å legge til din første."
          sortable
          title={(r) => s(r.title) ?? ""}
          subtitle={(r) => [s(r.employer), s(r.location)].filter(Boolean).join(" · ")}
          meta={period}
          body={(r) => s(r.description)}
          fields={[
            { name: "title", label: "Stillingstittel", placeholder: "F.eks. Butikkmedarbeider" },
            { name: "employer", label: "Arbeidsgiver" },
            { name: "location", label: "Sted", placeholder: "Oslo" },
            { name: "is_current", label: "Jeg jobber her nå", type: "checkbox" },
            { name: "start_date", label: "Startet", type: "month" },
            { name: "end_date", label: "Sluttet", type: "month", hideWhen: (v) => Boolean(v.is_current) },
            { name: "description", label: "Beskrivelse", type: "textarea", placeholder: "Ansvar, oppgaver og resultater" },
          ]}
        />
        <ListSection
          id="verv"
          table="volunteering"
          schema={volunteeringSchema}
          heading="Verv og frivillig arbeid"
          addLabel="Legg til verv"
          emptyText="Har du hatt verv eller gjort frivillig arbeid? Legg det til her."
          sortable
          title={(r) => s(r.role) ?? ""}
          subtitle={(r) => [s(r.organization), s(r.location)].filter(Boolean).join(" · ")}
          meta={period}
          body={(r) => s(r.description)}
          fields={[
            { name: "role", label: "Rolle", placeholder: "F.eks. Styremedlem" },
            { name: "organization", label: "Organisasjon", placeholder: "F.eks. Røde Kors" },
            { name: "location", label: "Sted" },
            { name: "is_current", label: "Jeg har dette vervet nå", type: "checkbox" },
            { name: "start_date", label: "Startet", type: "month" },
            { name: "end_date", label: "Sluttet", type: "month", hideWhen: (v) => Boolean(v.is_current) },
            { name: "description", label: "Beskrivelse", type: "textarea", placeholder: "Hva gjorde du, og hva lærte du?" },
          ]}
        />
        <ListSection
          id="utdanning"
          table="educations"
          schema={educationSchema}
          heading="Utdanning"
          addLabel="Legg til utdanning"
          emptyText="Ingen utdanning ennå. Klikk her for å legge til."
          sortable
          title={(r) => s(r.school) ?? ""}
          subtitle={(r) => [s(r.degree), s(r.field_of_study), s(r.location)].filter(Boolean).join(" · ")}
          meta={period}
          body={(r) => {
            // Engelske søkeord laget av AI, så brukeren ser hva extensionen søker etter i engelske skjemaer.
            const en = Array.isArray(r.field_of_study_en) ? (r.field_of_study_en as string[]).join(", ") : "";
            return [s(r.description), en && `På engelsk: ${en}`].filter(Boolean).join(" · ") || undefined;
          }}
          fields={[
            { name: "school", label: "Skole / lærested", wide: true },
            { name: "degree", label: "Grad", placeholder: "F.eks. Bachelor" },
            { name: "field_of_study", label: "Fagfelt", placeholder: "F.eks. Informatikk" },
            { name: "location", label: "Sted", placeholder: "F.eks. Bergen" },
            { name: "grade", label: "Karaktersnitt", placeholder: "F.eks. B eller 4,2" },
            { name: "start_date", label: "Startet", type: "month" },
            { name: "end_date", label: "Ferdig", type: "month" },
            { name: "description", label: "Beskrivelse", type: "textarea" },
          ]}
        />
        <ListSection
          table="certifications"
          schema={certificationSchema}
          heading="Kurs og sertifiseringer"
          addLabel="Legg til kurs"
          emptyText="Har du tatt kurs eller sertifiseringer? Legg dem til her."
          sortable
          title={(r) => s(r.name) ?? ""}
          subtitle={(r) => s(r.issuer)}
          meta={(r) => formatMonth(s(r.issued_date)) || undefined}
          fields={[
            { name: "name", label: "Navn", wide: true },
            { name: "issuer", label: "Utsteder" },
            { name: "issued_date", label: "Dato", type: "month" },
            { name: "url", label: "Lenke", type: "url", wide: true },
          ]}
        />
      </div>
    </div>
  );
}
