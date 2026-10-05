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
  return {
    fromDay: addDays(day, -RANGE_BEFORE),
    toDay: addDays(day, RANGE_AFTER),
  };
}

/** How many times a batch of queries is tried before the page gives up. */
const ATTEMPTS = 3;

type QueryError = { message: string; code?: string } | null | undefined;

/**
 * Runs a batch of queries, and runs the whole batch again if any of them failed.
 *
 * The first read after the database has been idle — the first visit of the day,
 * in practice — can come back 401 for one query out of the batch while its
 * siblings, carrying the very same token, succeed: PostgREST answers that one
 * from a worker that has just woken up. A second later the same token works. So
 * a failure here is worth retrying rather than showing as an error page.
 */
async function retrying<T>(
  what: string,
  run: (supabase: Awaited<ReturnType<typeof createClient>>) => Promise<T>,
  errorOf: (result: T) => QueryError,
): Promise<T> {
  let failed: QueryError;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 150 * attempt));
    const result = await run(await createClient(attempt));
    failed = errorOf(result);
    if (!failed) return result;
    console.warn(
      `[daylog] ${what} failed, attempt ${attempt + 1}/${ATTEMPTS}`,
      failed.code,
      failed.message,
    );
  }
  throw new Error(failed?.message ?? `${what} failed`);
}

/** Everything logged between two local days, inclusive. */
export async function loadEntries(
  tz: string,
  fromDay: string,
  toDay: string,
): Promise<RangeEntries> {
  const startMs = dayBoundsMs(tz, fromDay).start;
  const endMs = dayBoundsMs(tz, toDay).end;
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();

  const [actions, levels, carry, events] = await retrying(
    `entries ${fromDay}…${toDay}`,
    (supabase) =>
      Promise.all([
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
      ]),
    (rows) => rows.find((r) => r.error)?.error,
  );

  return {
    actions: actions.data ?? [],
    levels: [...(carry.data ?? []), ...(levels.data ?? [])],
    events: events.data ?? [],
  };
}

/** The initial payload for the timeline: a range of days plus your vocabularies. */
export async function loadTimeline(
  tz: string,
  focusDay: string,
): Promise<TimelineData> {
  const { fromDay, toDay } = rangeAround(focusDay);

  const [entries, [actionTypes, painTypes, exercises]] = await Promise.all([
    loadEntries(tz, fromDay, toDay),
    retrying(
      "vocabularies",
      (supabase) =>
        Promise.all([
          supabase.from("action_types").select("*").order("sort").order("name"),
          supabase.from("pain_types").select("*").order("sort").order("name"),
          supabase.from("exercises").select("*").order("sort").order("name"),
        ]),
      (rows) => rows.find((r) => r.error)?.error,
    ),
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
