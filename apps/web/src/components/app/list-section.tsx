"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { ZodType } from "zod";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useProfile, type ListTable } from "@/lib/profile-store";
import { cn } from "@/lib/utils";
import { SectionTitle } from "./page-header";

type Values = Record<string, unknown>;

export interface FieldConfig {
  name: string;
  label: string;
  type?: "text" | "textarea" | "month" | "date" | "select" | "checkbox" | "email" | "tel" | "url" | "number";
  options?: readonly { value: string; label: string }[];
  placeholder?: string;
  wide?: boolean;
  hideWhen?: (values: Values) => boolean;
}

interface ListSectionProps {
  id?: string;
  table: ListTable;
  schema: ZodType;
  fields: FieldConfig[];
  heading: string;
  description?: string;
  addLabel: string;
  emptyText: string;
  title: (row: Values) => string;
  subtitle?: (row: Values) => string | undefined;
  meta?: (row: Values) => string | undefined;
  body?: (row: Values) => string | undefined;
  sortable?: boolean;
}

/** Dato fra databasen (yyyy-mm-dd) ↔ verdi i <input type="month"> (yyyy-mm). */
const toInput = (f: FieldConfig, v: unknown) => (f.type === "month" && typeof v === "string" ? v.slice(0, 7) : v);
const fromInput = (f: FieldConfig, v: unknown) => {
  if (f.type === "month" && typeof v === "string" && v.length === 7) return `${v}-01`;
  if (f.type === "number" && typeof v === "string") return Number(v.replace(",", "."));
  return v;
};

export function ListSection(props: ListSectionProps) {
  const { profile, saveRow, deleteRow, reorder } = useProfile();
  const rows = profile[props.table] as Values[];
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const ids = rows.map((r) => r.id as string);

  function handleDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(ids, ids.indexOf(e.active.id as string), ids.indexOf(e.over.id as string));
    void reorder(props.table, next);
  }

  async function handleSave(values: Values) {
    const saved = await saveRow(props.table, values as never);
    if (saved) setEditing(null);
    return Boolean(saved);
  }

  return (
    <section>
      <SectionTitle
        id={props.id}
        title={props.heading}
        description={props.description}
        action={
          editing !== "new" && (
            <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
              <Plus /> {props.addLabel}
            </Button>
          )
        }
      />
      <div className="space-y-3">
        <AnimatePresence initial={false}>
          {editing === "new" && (
            <motion.div key="new" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <EntryEditor {...props} initial={{}} onCancel={() => setEditing(null)} onSave={handleSave} />
            </motion.div>
          )}
        </AnimatePresence>

        {rows.length === 0 && editing !== "new" ? (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="w-full rounded-2xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
          >
            {props.emptyText}
          </button>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              {rows.map((row) =>
                editing === row.id ? (
                  <EntryEditor key={row.id as string} {...props} initial={row} onCancel={() => setEditing(null)} onSave={handleSave} />
                ) : (
                  <EntryCard
                    key={row.id as string}
                    {...props}
                    row={row}
                    onEdit={() => setEditing(row.id as string)}
                    onDelete={() => {
                      if (confirm(`Slette «${props.title(row)}»?`)) void deleteRow(props.table, row.id as string);
                    }}
                  />
                ),
              )}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </section>
  );
}

function EntryCard({ row, title, subtitle, meta, body, sortable, onEdit, onDelete }: ListSectionProps & { row: Values; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id as string, disabled: !sortable });
  const sub = subtitle?.(row);
  const m = meta?.(row);
  const b = body?.(row);
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(isDragging && "relative z-10")}>
      <Card className={cn("group flex gap-3 p-4 transition", isDragging ? "shadow-xl ring-2 ring-primary/30" : "hover:border-primary/30")}>
        {sortable && (
          <button type="button" className="mt-0.5 cursor-grab touch-none self-start text-muted-foreground/50 hover:text-foreground active:cursor-grabbing" aria-label="Dra for å endre rekkefølge" {...attributes} {...listeners}>
            <GripVertical className="size-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 className="font-medium">{title(row)}</h3>
            {m && <span className="text-xs text-muted-foreground tabular-nums">{m}</span>}
          </div>
          {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
          {b && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground/90">{b}</p>}
        </div>
        <div className="flex shrink-0 gap-1 self-start opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Rediger">
            <Pencil />
          </Button>
          <Button variant="destructive" size="icon" onClick={onDelete} aria-label="Slett">
            <Trash2 />
          </Button>
        </div>
      </Card>
    </div>
  );
}

function EntryEditor({ fields, schema, initial, onCancel, onSave, table }: ListSectionProps & { initial: Values; onCancel: () => void; onSave: (v: Values) => Promise<boolean> }) {
  const [values, setValues] = useState<Values>(() => Object.fromEntries(fields.map((f) => [f.name, toInput(f, initial[f.name]) ?? (f.type === "checkbox" ? false : "")])));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const out: Values = { ...(initial.id ? { id: initial.id, sort_order: initial.sort_order } : {}) };
    for (const f of fields) {
      const hidden = f.hideWhen?.(values);
      out[f.name] = hidden ? null : fromInput(f, values[f.name] === "" ? null : values[f.name]);
    }
    const parsed = schema.safeParse(out);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setSaving(true);
    await onSave(out);
    setSaving(false);
  }

  return (
    <Card className="border-primary/40 p-5 ring-4 ring-primary/10">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {fields.map((f) => {
          if (f.hideWhen?.(values)) return null;
          const id = `${table}-${f.name}`;
          if (f.type === "checkbox") {
            return (
              <label key={f.name} className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={Boolean(values[f.name])} onChange={(e) => set(f.name, e.target.checked)} />
                {f.label}
              </label>
            );
          }
          const common = { id, name: f.name, placeholder: f.placeholder, "aria-invalid": errors[f.name] ? true : undefined, value: values[f.name] == null ? "" : String(values[f.name]) };
          return (
            <Field key={f.name} label={f.label} htmlFor={id} error={errors[f.name]} className={f.wide || f.type === "textarea" ? "sm:col-span-2" : undefined}>
              {f.type === "textarea" ? (
                <Textarea {...common} onChange={(e) => set(f.name, e.target.value)} />
              ) : f.type === "select" ? (
                <Select {...common} onChange={(e) => set(f.name, e.target.value)}>
                  <option value="">Velg …</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input {...common} type={f.type ?? "text"} onChange={(e) => set(f.name, e.target.value)} />
              )}
            </Field>
          );
        })}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Avbryt
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Lagrer …" : "Lagre"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
