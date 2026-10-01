import "server-only";
import { createClient } from "@/lib/supabase/server";
import { dayBoundsMs } from "@/lib/time";
import type { Tables } from "@/lib/database.types";

type DayResult = {
  day: string;
  startMs: number;
  endMs: number;
  actions: Tables<"actions">[];
  levels: { id: string; recorded_at: string; level: number }[];
  events: Tables<"pain_events">[];
  actionTypes: Tables<"action_types">[];
  painTypes: Tables<"pain_types">[];
  exercises: Tables<"exercises">[];
};

/** Everything the day timeline needs for one local day. */
export async function loadDay(tz: string, day: string, retry = true): Promise<DayResult> {
  const { start: startMs, end: endMs } = dayBoundsMs(tz, day);
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  const supabase = await createClient();

  const [actions, levels, carry, events, actionTypes, painTypes, exercises] = await Promise.all([
    supabase
      .from("actions")
      .select("*")
      .lt("started_at", end)
      .or(`ended_at.is.null,ended_at.gt.${start}`)
      .order("started_at"),
    supabase
      .from("pain_levels")
      .select("id, recorded_at, level")
      .gte("recorded_at", start)
      .lt("recorded_at", end)
      .order("recorded_at"),
    supabase
      .from("pain_levels")
      .select("id, recorded_at, level")
      .lt("recorded_at", start)
      .order("recorded_at", { ascending: false })
      .limit(1),
    supabase
      .from("pain_events")
      .select("*")
      .gte("occurred_at", start)
      .lt("occurred_at", end)
      .order("occurred_at"),
    supabase.from("action_types").select("*").order("sort").order("name"),
    supabase.from("pain_types").select("*").order("sort").order("name"),
    supabase.from("exercises").select("*").order("sort").order("name"),
  ]);

  const firstError = [actions, levels, carry, events, actionTypes, painTypes, exercises].find((r) => r.error)?.error;
  // A token refresh racing with this request can fail once; a retry uses the new cookies.
  if (firstError) {
    if (retry) {
      await new Promise((r) => setTimeout(r, 150));
      return loadDay(tz, day, false);
    }
    console.error("[daylog] day query failed", { day, message: firstError.message, code: firstError.code });
    throw new Error(firstError.message);
  }

  return {
    day,
    startMs,
    endMs,
    actions: actions.data ?? [],
    levels: [...(carry.data ?? []), ...(levels.data ?? [])],
    events: events.data ?? [],
    actionTypes: actionTypes.data ?? [],
    painTypes: painTypes.data ?? [],
    exercises: exercises.data ?? [],
  };
}

export type DayData = DayResult;
