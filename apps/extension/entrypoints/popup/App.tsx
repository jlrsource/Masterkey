import { browser } from "wxt/browser";
import { brandMarkSvg } from "@soknadsprofil/shared";
import { CheckCircle2, ExternalLink, Eraser, Loader2, LogOut, RefreshCw, TriangleAlert, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { sendToBackground, type ExtState } from "@/lib/messages";
import type { FieldReport, FillSummary } from "@/lib/types";

function Logo() {
  return (
    <div className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-[linear-gradient(135deg,var(--primary),var(--mint))] text-white">
        <span className="size-4" dangerouslySetInnerHTML={{ __html: brandMarkSvg({ size: 16 }) }} />
      </span>
      Masterkey
    </div>
  );
}

function timeAgo(ts: number | null) {
  if (!ts) return "aldri";
  const min = Math.round((Date.now() - ts) / 60000);
  if (min < 1) return "nå nettopp";
  if (min < 60) return `${min} min siden`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} t siden` : new Date(ts).toLocaleDateString("nb-NO");
}

export function App() {
  const [state, setState] = useState<ExtState | null>(null);
  const [filling, setFilling] = useState(false);
  const [result, setResult] = useState<FillSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);

  const load = useCallback(async () => setState(await sendToBackground({ type: "GET_STATE" })), []);

  useEffect(() => {
    void load();
    // Oppdater profilen i bakgrunnen hver gang popupen åpnes.
    void sendToBackground({ type: "REFRESH_PROFILE" }).then(load);
  }, [load]);

  async function fill() {
    setFilling(true);
    setError(null);
    const res = await sendToBackground({ type: "FILL_ACTIVE_TAB", overwrite });
    setFilling(false);
    if (res.ok) setResult(res.summary);
    else setError(res.error);
  }

  const openApp = (path = "/app") => browser.tabs.create({ url: `${state?.webAppUrl ?? ""}${path}` });

  if (!state) {
    return (
      <div className="grid h-40 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!state.email) {
    return (
      <div className="p-5">
        <Logo />
        <div className="mt-5 rounded-xl border bg-card p-4">
          <h1 className="font-semibold">Koble til profilen din</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Logg inn i Masterkey og trykk «Koble til» på extension-siden.</p>
          <button
            onClick={() => openApp("/app/extension")}
            className="mt-4 flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:brightness-110"
          >
            Åpne Masterkey <ExternalLink className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const fields = result?.fields.filter((f) => f.status === "filled" || f.status === "uncertain") ?? [];
  // Felt som ble funnet, men ikke fylt ut, gruppert etter årsak. Én forekomst per felttype.
  const notFilled = (status: FieldReport["status"]) => [
    ...new Set(
      (result?.fields ?? [])
        .filter((f) => f.status === status && !fields.some((x) => x.key === f.key))
        .map((f) => f.label),
    ),
  ];
  const missing = notFilled("no-value");
  const alreadyFilled = notFilled("skipped-has-value");
  const failed = notFilled("failed");

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <Logo />
        <div className="flex">
          <IconButton label="Hent profil på nytt" onClick={() => sendToBackground({ type: "REFRESH_PROFILE" }).then(load)}>
            <RefreshCw className="size-3.5" />
          </IconButton>
          <IconButton label="Logg ut" onClick={() => sendToBackground({ type: "SIGN_OUT" }).then(load)}>
            <LogOut className="size-3.5" />
          </IconButton>
        </div>
      </div>

      <button onClick={() => openApp()} className="mt-3 flex w-full items-center justify-between rounded-xl border bg-card px-3 py-2.5 text-left hover:border-primary/50">
        <div className="min-w-0">
          <div className="truncate font-medium">{state.name ?? state.email}</div>
          <div className="text-xs text-muted-foreground">Profil oppdatert {timeAgo(state.profileFetchedAt)}</div>
        </div>
        <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      <button
        onClick={fill}
        disabled={filling}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(100deg,var(--primary),color-mix(in_oklch,var(--primary)_55%,var(--mint)))] font-medium text-white shadow-md transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
      >
        {filling ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
        {filling ? "Fyller ut …" : "Fyll ut denne siden"}
      </button>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="accent-[var(--primary)]" />
        Overskriv felt som allerede er fylt ut
      </label>

      {error && (
        <div className="mt-3 flex gap-2 rounded-xl bg-destructive/10 p-3 text-[13px] text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-xl border bg-card p-3">
          {result.filled + result.uncertain === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {result.detected === 0 ? "Fant ingen skjemafelt på denne siden." : "Fant felt, men ingen som passet med profilen din."}
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="size-4 text-success" />
                {result.filled + result.uncertain} felt fylt ut
                {result.adapter && <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">{result.adapter}</span>}
              </div>
              {result.uncertain > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  <span className="mr-1 inline-block size-2 rounded-full bg-warning" />
                  {result.uncertain} usikre. Sjekk de gule feltene.
                </p>
              )}
              <ul className="mt-2 flex flex-wrap gap-1">
                {fields.map((f, i) => (
                  <li
                    key={`${f.key}-${i}`}
                    className={`rounded-full px-2 py-0.5 text-[11px] ${f.status === "filled" ? "bg-success/15 text-success" : "bg-warning/20"}`}
                  >
                    {f.label}
                  </li>
                ))}
              </ul>
              <button onClick={() => sendToBackground({ type: "CLEAR_HIGHLIGHTS" })} className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <Eraser className="size-3.5" /> Fjern markeringer
              </button>
            </>
          )}
          <NotFilled title="Mangler i profilen" items={missing} hint="Legg dem inn i Masterkey, så fylles de ut neste gang." />
          <NotFilled title="Allerede utfylt på siden" items={alreadyFilled} hint="Kryss av for «Overskriv» for å erstatte dem." />
          <NotFilled title="Kunne ikke fylles ut" items={failed} />
          {result.unrecognized?.length > 0 && (
            <details className="mt-3 border-t pt-2">
              <summary className="cursor-pointer text-xs font-medium">Ikke gjenkjent ({result.unrecognized.length})</summary>
              <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                {result.unrecognized.map((t) => (
                  <li key={t} className="truncate" title={t}>
                    {t}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <p className="mt-4 text-center text-[11px] text-muted-foreground">Ingenting sendes inn automatisk. Se over før du trykker «Send».</p>
    </div>
  );
}

function NotFilled({ title, items, hint }: { title: string; items: string[]; hint?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3 border-t pt-2">
      <div className="text-xs font-medium">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{items.join(", ")}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
      {children}
    </button>
  );
}
