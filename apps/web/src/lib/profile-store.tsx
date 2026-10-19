"use client";

import {
  emptyProfile,
  fullProfileSchema,
  type FullProfile,
  type Personal,
  type ProfileDocument,
} from "@soknadsprofil/shared";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { notifyProfileUpdated } from "./extension-bridge";
import { getSupabase } from "./supabase/client";

export type ListTable = "experiences" | "volunteering" | "educations" | "certifications" | "skills" | "languages" | "references" | "saved_answers";
type Row<T extends ListTable> = FullProfile[T][number];

interface ProfileContextValue {
  profile: FullProfile;
  loading: boolean;
  userId: string | null;
  userEmail: string | null;
  updatePersonal: (patch: Partial<Personal>) => Promise<void>;
  saveRow: <T extends ListTable>(table: T, row: Row<T>) => Promise<Row<T> | null>;
  deleteRow: (table: ListTable, id: string) => Promise<void>;
  reorder: (table: ListTable, ids: string[]) => Promise<void>;
  uploadDocument: (file: File, type: ProfileDocument["type"]) => Promise<ProfileDocument | null>;
  deleteDocument: (doc: ProfileDocument) => Promise<void>;
  setDefaultDocument: (doc: ProfileDocument) => Promise<void>;
  changeDocumentType: (doc: ProfileDocument, type: ProfileDocument["type"]) => Promise<void>;
  getDocumentUrl: (doc: ProfileDocument) => Promise<string | null>;
  reload: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

/** Tomme strenger lagres som null, så dato- og tekstkolonner holdes rene. */
function clean<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === "" ? null : v])) as T;
}

const TABLE_LABELS: Record<ListTable, string> = {
  experiences: "arbeidserfaring",
  volunteering: "verv",
  educations: "utdanning",
  certifications: "kurs",
  skills: "ferdighet",
  languages: "språk",
  references: "referanse",
  saved_answers: "standardsvar",
};

type DbError = { message: string; code?: string; details?: string | null; hint?: string | null };

/** Tekniske detaljer vises bare under utvikling. Vanlige brukere får en generell melding. */
function describeError(error: DbError): string {
  if (process.env.NODE_ENV !== "development") return "Prøv igjen om litt. Hvis det fortsetter, ta kontakt med oss.";
  const missingTable = error.code === "PGRST205" || error.code === "42P01";
  return missingTable ? "Tabellen finnes ikke i databasen. Har du kjørt alle migrasjonene i supabase/migrations?" : error.message;
}

function fail(action: string, error: DbError | null) {
  if (!error) {
    notifyProfileUpdated();
    return false;
  }
  // PostgrestError logges som {} i nettleseren, så vi skriver ut feltene eksplisitt.
  console.warn(`Kunne ikke ${action}: ${error.message}`, { code: error.code, details: error.details, hint: error.hint });
  toast.error(`Kunne ikke ${action}`, { description: describeError(error) });
  return true;
}

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const supabase = getSupabase();
  const [profile, setProfile] = useState<FullProfile>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  /**
   * Lager engelske søkeord for fagfeltet i bakgrunnen (brukes av extensionen i engelske skjemaer).
   * Serveren hopper over utdanninger der fagfeltet ikke har endret seg. Feil ignoreres stille:
   * extensionen har en innebygd oversettelsesliste som reserve.
   */
  const translateEducation = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/education/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ educationId: id }),
      });
      if (!res.ok) return;
      const { terms } = (await res.json()) as { terms: string[] | null };
      setProfile((p) => ({
        ...p,
        educations: p.educations.map((e) => (e.id === id ? { ...e, field_of_study_en: terms } : e)),
      }));
      notifyProfileUpdated();
    } catch {
      // Ingen nett eller ingen API-nøkkel: extensionen bruker reservelisten.
    }
  }, []);

  const reload = useCallback(async () => {
    const [{ data: userData }, { data, error }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc("get_full_profile"),
    ]);
    if (userData.user) setUser({ id: userData.user.id, email: userData.user.email ?? null });
    if (error) {
      console.error(error);
      toast.error("Kunne ikke laste profilen", { description: describeError(error) });
    } else {
      const parsed = fullProfileSchema.safeParse(data);
      if (!parsed.success) console.warn("Profilen matchet ikke skjemaet", parsed.error.issues);
      const loaded = parsed.success ? parsed.data : { ...emptyProfile(), ...(data as Partial<FullProfile>) };
      setProfile(loaded);
      // Utdanninger fra før denne funksjonen fantes: oversett fagfeltet én gang.
      for (const e of loaded.educations) {
        if (e.id && e.field_of_study && !e.field_of_study_en) void translateEducation(e.id);
      }
    }
    setLoading(false);
  }, [supabase, translateEducation]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const updatePersonal = useCallback<ProfileContextValue["updatePersonal"]>(
    async (patch) => {
      if (!user) return;
      const cleaned = clean(patch);
      setProfile((p) => ({ ...p, personal: { ...p.personal, ...cleaned } }));
      const { error } = await supabase.from("profiles").upsert({ user_id: user.id, ...cleaned });
      fail("lagre personalia", error);
    },
    [supabase, user],
  );

  const saveRow = useCallback<ProfileContextValue["saveRow"]>(
    async (table, row) => {
      const { id, ...rest } = clean(row as Record<string, unknown>) as Record<string, unknown> & { id?: string };
      const isNew = !id;
      if (isNew && "sort_order" in rest) rest.sort_order = profileRef.current[table].length;
      const query = isNew
        ? supabase.from(table).insert(rest).select().single()
        : supabase.from(table).update(rest).eq("id", id).select().single();
      const { data, error } = await query;
      if (fail(`lagre ${TABLE_LABELS[table]}`, error)) return null;
      const { user_id: _u, created_at: _c, updated_at: _up, ...saved } = data as Record<string, unknown>;
      setProfile((p) => {
        const list = p[table] as Row<typeof table>[];
        const next = isNew ? [...list, saved] : list.map((r) => ((r as { id?: string }).id === id ? saved : r));
        return { ...p, [table]: next };
      });
      if (table === "educations" && typeof saved.id === "string") void translateEducation(saved.id);
      return saved as Row<typeof table>;
    },
    [supabase, translateEducation],
  );

  const deleteRow = useCallback<ProfileContextValue["deleteRow"]>(
    async (table, id) => {
      const before = profileRef.current;
      setProfile((p) => ({ ...p, [table]: (p[table] as { id?: string }[]).filter((r) => r.id !== id) }));
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (fail("slette", error)) setProfile(before);
    },
    [supabase],
  );

  const reorder = useCallback<ProfileContextValue["reorder"]>(
    async (table, ids) => {
      setProfile((p) => {
        const byId = new Map((p[table] as { id?: string }[]).map((r) => [r.id, r]));
        const next = ids.map((id, i) => ({ ...byId.get(id), sort_order: i }));
        return { ...p, [table]: next };
      });
      const results = await Promise.all(ids.map((id, i) => supabase.from(table).update({ sort_order: i }).eq("id", id)));
      fail("lagre rekkefølgen", results.find((r) => r.error)?.error ?? null);
    },
    [supabase],
  );

  const uploadDocument = useCallback<ProfileContextValue["uploadDocument"]>(
    async (file, type) => {
      if (!user) return null;
      const safeName = file.name.replace(/[^\w.\-æøåÆØÅ ]+/g, "_");
      const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type });
      if (fail("laste opp filen", upErr)) return null;
      const isFirstOfType = !profileRef.current.documents.some((d) => d.type === type);
      const { data, error } = await supabase
        .from("documents")
        .insert({ type, file_name: file.name, storage_path: path, mime_type: file.type, size_bytes: file.size, is_default: isFirstOfType })
        .select()
        .single();
      if (fail("lagre dokumentet", error)) {
        await supabase.storage.from("documents").remove([path]);
        return null;
      }
      setProfile((p) => ({ ...p, documents: [data as ProfileDocument, ...p.documents] }));
      toast.success(`${file.name} er lastet opp`);
      return data as ProfileDocument;
    },
    [supabase, user],
  );

  const deleteDocument = useCallback<ProfileContextValue["deleteDocument"]>(
    async (doc) => {
      if (!doc.id) return;
      const { error } = await supabase.from("documents").delete().eq("id", doc.id);
      if (fail("slette dokumentet", error)) return;
      await supabase.storage.from("documents").remove([doc.storage_path]);
      setProfile((p) => ({ ...p, documents: p.documents.filter((d) => d.id !== doc.id) }));
    },
    [supabase],
  );

  const setDefaultDocument = useCallback<ProfileContextValue["setDefaultDocument"]>(
    async (doc) => {
      if (!doc.id || !user) return;
      // Fjern gammel standard først pga. unik indeks på (user_id, type) where is_default.
      const { error: e1 } = await supabase.from("documents").update({ is_default: false }).eq("type", doc.type).eq("is_default", true);
      if (fail("endre standarddokument", e1)) return;
      const { error: e2 } = await supabase.from("documents").update({ is_default: true }).eq("id", doc.id);
      if (fail("endre standarddokument", e2)) return;
      setProfile((p) => ({
        ...p,
        documents: p.documents.map((d) => (d.type === doc.type ? { ...d, is_default: d.id === doc.id } : d)),
      }));
    },
    [supabase, user],
  );

  const changeDocumentType = useCallback<ProfileContextValue["changeDocumentType"]>(
    async (doc, type) => {
      if (!doc.id || doc.type === type) return;
      const docs = profileRef.current.documents;
      // Blir det første dokumentet av den nye typen, gjør vi det til standard.
      const becomesDefault = !docs.some((d) => d.type === type && d.is_default);
      const { error } = await supabase.from("documents").update({ type, is_default: becomesDefault }).eq("id", doc.id);
      if (fail("endre dokumenttype", error)) return;

      // Var det standard for den gamle typen, overtar neste dokument av den typen.
      const successor = doc.is_default ? docs.find((d) => d.type === doc.type && d.id !== doc.id) : undefined;
      if (successor?.id) {
        const { error: e2 } = await supabase.from("documents").update({ is_default: true }).eq("id", successor.id);
        fail("endre standarddokument", e2);
      }
      setProfile((p) => ({
        ...p,
        documents: p.documents.map((d) =>
          d.id === doc.id ? { ...d, type, is_default: becomesDefault } : d.id === successor?.id ? { ...d, is_default: true } : d,
        ),
      }));
    },
    [supabase],
  );

  const getDocumentUrl = useCallback<ProfileContextValue["getDocumentUrl"]>(
    async (doc) => {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.storage_path, 60);
      return fail("åpne dokumentet", error) || !data ? null : data.signedUrl;
    },
    [supabase],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      loading,
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      updatePersonal,
      saveRow,
      deleteRow,
      reorder,
      uploadDocument,
      deleteDocument,
      setDefaultDocument,
      changeDocumentType,
      getDocumentUrl,
      reload,
    }),
    [profile, loading, user, updatePersonal, saveRow, deleteRow, reorder, uploadDocument, deleteDocument, setDefaultDocument, changeDocumentType, getDocumentUrl, reload],
  );

  return <ProfileContext value={value}>{children}</ProfileContext>;
}

export function useProfile() {
  const ctx = use(ProfileContext);
  if (!ctx) throw new Error("useProfile må brukes inne i <ProfileProvider>");
  return ctx;
}
