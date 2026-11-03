"use client";

import { DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, type ProfileDocument } from "@soknadsprofil/shared";
import { ExternalLink, FileText, Loader2, Sparkles, Star, Trash2, UploadCloud } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { LoadingBlock, PageHeader, SectionTitle } from "@/components/app/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useProfile } from "@/lib/profile-store";
import { cn, formatBytes } from "@/lib/utils";

const MAX_BYTES = 10 * 1024 * 1024;

/** Gjetter dokumenttypen ut fra filnavnet. Faller tilbake på typen brukeren har valgt. */
function guessType(fileName: string, fallback: ProfileDocument["type"]): ProfileDocument["type"] {
  const n = fileName.toLowerCase();
  if (/arbeidsattest|attest|reference|anbefaling|employment/.test(n)) return "work_certificate";
  if (/vitnem[åa]l|transcript|karakter|diploma|grades/.test(n)) return "diploma";
  if (/s[øo]knad|cover.?letter|motivasjon/.test(n)) return "cover_letter";
  if (/\bcv\b|resume|résumé|curriculum/.test(n.replace(/[_\-.]/g, " "))) return "cv";
  return fallback;
}
const ACCEPT = ".pdf,.doc,.docx,.odt,.txt,.png,.jpg,.jpeg";

export default function DokumenterPage() {
  const { profile, loading, uploadDocument, deleteDocument, setDefaultDocument, changeDocumentType, getDocumentUrl } = useProfile();
  const [type, setType] = useState<ProfileDocument["type"]>("cv");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  if (loading) return <LoadingBlock />;

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} er større enn 10 MB`);
        continue;
      }
      setUploading((n) => n + 1);
      await uploadDocument(file, guessType(file.name, type));
      setUploading((n) => n - 1);
    }
  }

  async function open(doc: ProfileDocument) {
    const url = await getDocumentUrl(doc);
    if (url) window.open(url, "_blank", "noopener");
  }

  return (
    <div>
      <PageHeader title="Dokumenter" description="CV-en du merker som standard lastes opp automatisk av extensionen." />

      <Card
        className={cn("relative overflow-hidden border-2 border-dashed p-8 text-center transition", dragging && "border-primary bg-primary/5")}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <motion.div animate={{ y: dragging ? -4 : 0 }} className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          {uploading > 0 ? <Loader2 className="size-6 animate-spin" /> : <UploadCloud className="size-6" />}
        </motion.div>
        <p className="mt-4 font-medium">{uploading > 0 ? "Laster opp …" : "Slipp filer her"}</p>
        <p className="mt-1 text-sm text-muted-foreground">PDF, Word eller bilde. Maks 10 MB. Typen gjettes ut fra filnavnet.</p>
        <div className="mx-auto mt-5 flex max-w-sm flex-col items-center gap-2 sm:flex-row">
          <Select value={type} onChange={(e) => setType(e.target.value as ProfileDocument["type"])} aria-label="Dokumenttype">
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOCUMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
          <Button onClick={() => inputRef.current?.click()} className="w-full sm:w-auto">
            Velg fil
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </Card>

      <div className="mt-10 space-y-10">
        {DOCUMENT_TYPES.map((t) => {
          const docs = profile.documents.filter((d) => d.type === t);
          if (docs.length === 0) return null;
          return (
            <section key={t}>
              <SectionTitle title={DOCUMENT_TYPE_LABELS[t]} />
              <ul className="space-y-2">
                <AnimatePresence initial={false}>
                  {docs.map((doc) => (
                    <motion.li key={doc.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -20 }}>
                      <Card className="flex items-center gap-3 p-3 pl-4">
                        <FileText className="size-5 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => open(doc)} className="truncate text-left font-medium hover:underline">
                              {doc.file_name}
                            </button>
                            {doc.is_default && <Badge tone="primary">Standard</Badge>}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <select
                              value={doc.type}
                              onChange={(e) => changeDocumentType(doc, e.target.value as ProfileDocument["type"])}
                              aria-label={`Type for ${doc.file_name}`}
                              className="-ml-1 cursor-pointer rounded-md bg-transparent px-1 py-0.5 font-medium text-foreground hover:bg-muted"
                            >
                              {DOCUMENT_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {DOCUMENT_TYPE_LABELS[t]}
                                </option>
                              ))}
                            </select>
                            <span>
                              {formatBytes(doc.size_bytes)}
                              {doc.created_at && ` · ${new Date(doc.created_at).toLocaleDateString("nb-NO")}`}
                            </span>
                          </div>
                        </div>
                        {doc.type === "cv" && (
                          <Link href={`/app/importer-cv?doc=${doc.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                            <Sparkles /> <span className="hidden sm:inline">Fyll ut profil</span>
                          </Link>
                        )}
                        {!doc.is_default && (
                          <Button variant="ghost" size="sm" onClick={() => setDefaultDocument(doc)}>
                            <Star /> <span className="hidden sm:inline">Gjør til standard</span>
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => open(doc)} aria-label="Åpne">
                          <ExternalLink />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          aria-label="Slett"
                          onClick={() => confirm(`Slette ${doc.file_name}?`) && deleteDocument(doc)}
                        >
                          <Trash2 />
                        </Button>
                      </Card>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          );
        })}
        {profile.documents.length === 0 && <p className="text-center text-sm text-muted-foreground">Ingen dokumenter ennå.</p>}
      </div>
    </div>
  );
}
