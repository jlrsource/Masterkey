import { Briefcase, FileText, LayoutDashboard, ListChecks, MessageSquareText, Puzzle, Sparkles, User } from "lucide-react";

export const NAV = [
  { href: "/app", label: "Oversikt", icon: LayoutDashboard },
  { href: "/app/personalia", label: "Personalia", icon: User },
  { href: "/app/erfaring", label: "Erfaring og utdanning", icon: Briefcase },
  { href: "/app/ferdigheter", label: "Ferdigheter og språk", icon: Sparkles },
  { href: "/app/dokumenter", label: "Dokumenter", icon: FileText },
  { href: "/app/soknadssvar", label: "Søknadssvar", icon: ListChecks },
  { href: "/app/svar", label: "Standardsvar", icon: MessageSquareText },
  { href: "/app/extension", label: "Chrome-extension", icon: Puzzle },
] as const;

export const SECTION_HREF = {
  personal: "/app/personalia",
  experience: "/app/erfaring",
  education: "/app/erfaring#utdanning",
  skills: "/app/ferdigheter",
  documents: "/app/dokumenter",
  answers: "/app/svar",
} as const;
