import { NextResponse, type NextRequest } from "next/server";
import { translateFieldOfStudy } from "@/lib/ai/translate-field";
import { createSupabaseServer } from "@/lib/supabase/server";

export const maxDuration = 60;

/**
 * Lager engelske søkeord for fagfeltet til en utdanning og lagrer dem på raden.
 * Oversetter bare når fagfeltet har endret seg siden sist (field_of_study_en_source).
 */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Ikke innlogget" }, { status: 401 });

  const { educationId } = (await request.json().catch(() => ({}))) as { educationId?: string };
  if (!educationId) return NextResponse.json({ error: "educationId mangler" }, { status: 400 });

  // RLS: brukeren får bare hentet sine egne utdanninger.
  const { data: edu } = await supabase
    .from("educations")
    .select("field_of_study, degree, field_of_study_en, field_of_study_en_source")
    .eq("id", educationId)
    .single();
  if (!edu) return NextResponse.json({ error: "Fant ikke utdanningen" }, { status: 404 });

  const field = (edu.field_of_study as string | null)?.trim() ?? "";
  if (!field) {
    if (edu.field_of_study_en) await supabase.from("educations").update({ field_of_study_en: null, field_of_study_en_source: null }).eq("id", educationId);
    return NextResponse.json({ terms: null });
  }
  if (edu.field_of_study_en_source === field && edu.field_of_study_en) {
    return NextResponse.json({ terms: edu.field_of_study_en });
  }

  try {
    const terms = await translateFieldOfStudy(field, edu.degree as string | null);
    const { error } = await supabase.from("educations").update({ field_of_study_en: terms, field_of_study_en_source: field }).eq("id", educationId);
    if (error) throw error;
    return NextResponse.json({ terms });
  } catch (error) {
    console.error("Oversettelse av fagfelt feilet", error);
    return NextResponse.json({ error: "Kunne ikke oversette fagfeltet" }, { status: 502 });
  }
}
