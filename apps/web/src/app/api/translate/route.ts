import { NextResponse, type NextRequest } from "next/server";
import { translateToEnglish } from "@/lib/ai/translate-text";
import { createSupabaseServer } from "@/lib/supabase/server";

export const maxDuration = 30;

/** Korte søknadssvar (maks 300 tegn) oversatt til engelsk, f.eks. «Via bedriftskontakter på NTNU». */
export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Ikke innlogget" }, { status: 401 });

  const { text } = (await request.json().catch(() => ({}))) as { text?: string };
  const clean = text?.trim() ?? "";
  if (!clean) return NextResponse.json({ english: "" });
  if (clean.length > 300) return NextResponse.json({ error: "Teksten er for lang" }, { status: 400 });

  try {
    return NextResponse.json({ english: await translateToEnglish(clean) });
  } catch (error) {
    console.error("Oversettelse feilet", error);
    return NextResponse.json({ error: "Kunne ikke oversette teksten" }, { status: 502 });
  }
}
