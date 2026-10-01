"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; ok?: number } | undefined;

function str(fd: FormData, key: string, max = 200) {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t === "" ? null : t;
}

function color(fd: FormData, fallback: string) {
  const v = str(fd, "color");
  return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
}

function finish(error: { code?: string; message: string } | null): FormState {
  if (error) {
    return { error: error.code === "23505" ? "You already have one with that name." : error.message };
  }
  revalidatePath("/", "layout");
  return { ok: Date.now() };
}

// ---- actions & pain vocabulary -------------------------------------------

export async function saveActionType(_: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  const name = str(fd, "name", 60);
  if (!name) return { error: "Name is required." };

  const row = { name, emoji: str(fd, "emoji", 8), color: color(fd, "#2f5d50") };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("action_types").update(row).eq("id", id)
    : await supabase.from("action_types").insert({ ...row, category: "other" });
  return finish(error);
}

export async function savePainType(_: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  const name = str(fd, "name", 60);
  if (!name) return { error: "Name is required." };

  const row = { name, color: color(fd, "#c23a3a") };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("pain_types").update(row).eq("id", id)
    : await supabase.from("pain_types").insert(row);
  return finish(error);
}

export async function setArchived(fd: FormData) {
  const id = str(fd, "id");
  const table = str(fd, "table");
  if (!id || (table !== "action_types" && table !== "pain_types")) return;
  const supabase = await createClient();
  await supabase
    .from(table)
    .update({ archived: str(fd, "archived") === "true" })
    .eq("id", id);
  revalidatePath("/", "layout");
}

/** Deletes the type itself. Entries already logged keep their name and colour. */
export async function deleteType(fd: FormData) {
  const id = str(fd, "id");
  const table = str(fd, "table");
  if (!id || (table !== "action_types" && table !== "pain_types")) return;
  const supabase = await createClient();
  await supabase.from(table).delete().eq("id", id);
  revalidatePath("/", "layout");
}

export async function seedDefaults() {
  const supabase = await createClient();
  await supabase.rpc("seed_default_types");
  revalidatePath("/", "layout");
}

// ---- exercises -----------------------------------------------------------

function int(fd: FormData, key: string, min: number, max: number) {
  const raw = str(fd, key);
  if (raw === null) return { value: null as number | null };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return { error: `${key} must be ${min}–${max}.` };
  return { value: n };
}

export async function saveExercise(_: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  const name = str(fd, "name", 60);
  if (!name) return { error: "Name is required." };

  const sets = int(fd, "sets", 1, 99);
  const reps = int(fd, "reps", 1, 999);
  const rest = int(fd, "rest_sec", 0, 3600);
  const minutes = int(fd, "duration_min", 1, 600);
  const bad = [sets, reps, rest, minutes].find((f) => f.error);
  if (bad?.error) return { error: bad.error };

  const weightRaw = str(fd, "weight_kg");
  const weight = weightRaw === null ? null : Number(weightRaw);
  if (weight !== null && (!Number.isFinite(weight) || weight < 0 || weight > 9999)) {
    return { error: "Weight looks wrong." };
  }

  const row = {
    name,
    emoji: str(fd, "emoji", 8),
    color: color(fd, "#2f5d50"),
    sets: sets.value,
    reps: reps.value,
    weight_kg: weight,
    rest_sec: rest.value,
    duration_min: minutes.value,
    notes: str(fd, "notes", 500),
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("exercises").update(row).eq("id", id)
    : await supabase.from("exercises").insert(row);
  return finish(error);
}

export async function deleteExercise(fd: FormData) {
  const id = str(fd, "id");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("exercises").delete().eq("id", id);
  revalidatePath("/", "layout");
}

export async function setExerciseArchived(fd: FormData) {
  const id = str(fd, "id");
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("exercises")
    .update({ archived: str(fd, "archived") === "true" })
    .eq("id", id);
  revalidatePath("/", "layout");
}

// ---- timer bar -----------------------------------------------------------

/** An unchecked box leaves its field out of the form, which reads back as "off". */
function minutes(fd: FormData, key: string): number | null | "bad" {
  const raw = str(fd, key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 600 ? n : "bad";
}

/**
 * Both timers for one activity on the bar. They are separate on purpose:
 * `limit_min` only nudges you, `end_min` actually stops the activity and can
 * hand over to `next_type_id`.
 */
export async function saveTimerSettings(_: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "id");
  if (!id) return { error: "Unknown activity." };

  const notifyAfter = minutes(fd, "limit_min");
  if (notifyAfter === "bad") return { error: "Notify after must be 1–600 minutes." };
  const endAfter = minutes(fd, "end_min");
  if (endAfter === "bad") return { error: "End after must be 1–600 minutes." };

  // Nothing to hand over to when the activity never ends on its own.
  const next = endAfter === null ? null : str(fd, "next_type_id");
  if (next === id) return { error: "An activity cannot follow itself." };

  const supabase = await createClient();
  if (next) {
    const { data } = await supabase.from("action_types").select("id").eq("id", next).maybeSingle();
    if (!data) return { error: "That follow-on activity no longer exists." };
  }
  const { error } = await supabase
    .from("action_types")
    .update({ limit_min: notifyAfter, end_min: endAfter, next_type_id: next })
    .eq("id", id);
  return finish(error);
}

export async function addToTimerBar(fd: FormData) {
  const id = str(fd, "id");
  if (!id) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("action_types")
    .select("sort")
    .eq("timer", true)
    .order("sort", { ascending: false })
    .limit(1);
  const sort = (data?.[0]?.sort ?? 0) + 1;
  await supabase.from("action_types").update({ timer: true, sort }).eq("id", id);
  revalidatePath("/", "layout");
}

export async function removeFromTimerBar(fd: FormData) {
  const id = str(fd, "id");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("action_types").update({ timer: false }).eq("id", id);
  revalidatePath("/", "layout");
}

/** Swap an activity with its neighbour so the bar keeps your order. */
export async function moveTimerTask(fd: FormData) {
  const id = str(fd, "id");
  const up = str(fd, "dir") === "up";
  if (!id) return;

  const supabase = await createClient();
  const { data: bar } = await supabase
    .from("action_types")
    .select("id, sort")
    .eq("timer", true)
    .order("sort")
    .order("name");
  if (!bar) return;

  const index = bar.findIndex((t) => t.id === id);
  const other = bar[up ? index - 1 : index + 1];
  if (index === -1 || !other) return;

  // Sort values can be equal after seeding, so renumber the whole bar in one pass.
  const reordered = [...bar];
  reordered[index] = other;
  reordered[up ? index - 1 : index + 1] = bar[index];
  await Promise.all(
    reordered.map((t, i) => supabase.from("action_types").update({ sort: i + 1 }).eq("id", t.id)),
  );
  revalidatePath("/", "layout");
}
