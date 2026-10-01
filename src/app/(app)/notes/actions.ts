"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type NoteState = { error?: string; ok?: number } | undefined;

const MAX = 10_000;

function body(fd: FormData) {
  const v = fd.get("body");
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, MAX);
  return t === "" ? null : t;
}

function id(fd: FormData) {
  const v = fd.get("id");
  return typeof v === "string" && v !== "" ? v : null;
}

export async function createNote(_: NoteState, fd: FormData): Promise<NoteState> {
  const text = body(fd);
  if (!text) return { error: "Write something first." };
  const supabase = await createClient();
  const { error } = await supabase.from("notes").insert({ body: text });
  if (error) return { error: error.message };
  revalidatePath("/notes");
  return { ok: Date.now() };
}

export async function updateNote(_: NoteState, fd: FormData): Promise<NoteState> {
  const noteId = id(fd);
  const text = body(fd);
  if (!noteId) return { error: "Unknown note." };
  if (!text) return { error: "A note cannot be empty — delete it instead." };
  const supabase = await createClient();
  const { error } = await supabase.from("notes").update({ body: text }).eq("id", noteId);
  if (error) return { error: error.message };
  revalidatePath("/notes");
  return { ok: Date.now() };
}

export async function togglePin(fd: FormData) {
  const noteId = id(fd);
  if (!noteId) return;
  const supabase = await createClient();
  await supabase.from("notes").update({ pinned: fd.get("pinned") === "true" }).eq("id", noteId);
  revalidatePath("/notes");
}

export async function deleteNote(fd: FormData) {
  const noteId = id(fd);
  if (!noteId) return;
  const supabase = await createClient();
  await supabase.from("notes").delete().eq("id", noteId);
  revalidatePath("/notes");
}
