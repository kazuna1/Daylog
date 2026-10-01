import "server-only";
import { createClient } from "@/lib/supabase/server";
import { addDays, dayBoundsMs } from "@/lib/time";
import type { Tables } from "@/lib/database.types";

/** Entries that fall inside one stretch of time. */
export type RangeEntries = {
  actions: Tables<"actions">[];
  /** Readings inside the range, plus the last one before it (carried in). */
  levels: { id: string; recorded_at: string; level: number }[];
  events: Tables<"pain_events">[];
};

export type TimelineData = RangeEntries & {
  /** First and last local day covered, inclusive. */
  fromDay: string;
  toDay: string;
  startMs: number;
  endMs: number;
  actionTypes: Tables<"action_types">[];
  painTypes: Tables<"pain_types">[];
  exercises: Tables<"exercises">[];
};

/** How many days load with the page, either side of the one you opened. */
export const RANGE_BEFORE = 3;
export const RANGE_AFTER = 1;

export function rangeAround(day: string) {
  return { fromDay: addDays(day, -RANGE_BEFORE), toDay: addDays(day, RANGE_AFTER) };
}

/** Everything logged between two local days, inclusive. */
export async function loadEntries(
  tz: string,
  fromDay: string,
  toDay: string,
  retry = true,
): Promise<RangeEntries> {
  const startMs = dayBoundsMs(tz, fromDay).start;
  const endMs = dayBoundsMs(tz, toDay).end;
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  const supabase = await createClient();

  const [actions, levels, carry, events] = await Promise.all([
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
  ]);

  const failed = [actions, levels, carry, events].find((r) => r.error)?.error;
  if (failed) {
    // A token refresh racing with this request can fail once; a retry uses the new cookies.
    if (retry) {
      await new Promise((r) => setTimeout(r, 150));
      return loadEntries(tz, fromDay, toDay, false);
    }
    console.error("[daylog] range query failed", { fromDay, toDay, message: failed.message, code: failed.code });
    throw new Error(failed.message);
  }

  return {
    actions: actions.data ?? [],
    levels: [...(carry.data ?? []), ...(levels.data ?? [])],
    events: events.data ?? [],
  };
}

/** The initial payload for the timeline: a range of days plus your vocabularies. */
export async function loadTimeline(tz: string, focusDay: string): Promise<TimelineData> {
  const { fromDay, toDay } = rangeAround(focusDay);
  const supabase = await createClient();

  const [entries, actionTypes, painTypes, exercises] = await Promise.all([
    loadEntries(tz, fromDay, toDay),
    supabase.from("action_types").select("*").order("sort").order("name"),
    supabase.from("pain_types").select("*").order("sort").order("name"),
    supabase.from("exercises").select("*").order("sort").order("name"),
  ]);

  return {
    ...entries,
    fromDay,
    toDay,
    startMs: dayBoundsMs(tz, fromDay).start,
    endMs: dayBoundsMs(tz, toDay).end,
    actionTypes: actionTypes.data ?? [],
    painTypes: painTypes.data ?? [],
    exercises: exercises.data ?? [],
  };
}
