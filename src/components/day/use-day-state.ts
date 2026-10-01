"use client";

import { useOptimistic, useState, useTransition } from "react";
import type { RangeEntries } from "@/lib/day-data";
import type { Action, ActionType, Exercise, PainEvent, PainType } from "@/lib/database.types";
import {
  addAction,
  addPainEvent,
  addPainLevel,
  deleteAction,
  deletePainEvent,
  deletePainLevel,
  clearDay,
  endAction,
  logExercise,
  setActionNotes,
  setActionPain,
  switchTask,
  updateAction,
  updatePainEvent,
  type Result,
} from "@/app/(app)/timeline-actions";

type Level = RangeEntries["levels"][number];
type Entries = RangeEntries;

type Op =
  | { kind: "addAction"; row: Action }
  | { kind: "patchAction"; id: string; patch: Partial<Action> }
  | { kind: "deleteAction"; id: string }
  | { kind: "addLevel"; row: Level }
  | { kind: "deleteLevel"; id: string }
  | { kind: "addEvent"; row: PainEvent }
  | { kind: "patchEvent"; id: string; patch: Partial<PainEvent> }
  | { kind: "deleteEvent"; id: string }
  | { kind: "clearDay"; startMs: number; endMs: number };

function reduce(state: Entries, op: Op): Entries {
  switch (op.kind) {
    case "addAction":
      return { ...state, actions: [...state.actions, op.row] };
    case "patchAction":
      return { ...state, actions: state.actions.map((a) => (a.id === op.id ? { ...a, ...op.patch } : a)) };
    case "deleteAction":
      return { ...state, actions: state.actions.filter((a) => a.id !== op.id) };
    case "addLevel":
      return {
        ...state,
        levels: [...state.levels, op.row].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)),
      };
    case "deleteLevel":
      return { ...state, levels: state.levels.filter((l) => l.id !== op.id) };
    case "addEvent":
      return { ...state, events: [...state.events, op.row] };
    case "patchEvent":
      return { ...state, events: state.events.map((e) => (e.id === op.id ? { ...e, ...op.patch } : e)) };
    case "deleteEvent":
      return { ...state, events: state.events.filter((e) => e.id !== op.id) };
    case "clearDay": {
      const inside = (iso: string) => {
        const t = new Date(iso).getTime();
        return t >= op.startMs && t < op.endMs;
      };
      return {
        actions: state.actions.filter(
          (a) => !(new Date(a.started_at).getTime() < op.endMs && (a.ended_at === null || new Date(a.ended_at).getTime() > op.startMs)),
        ),
        levels: state.levels.filter((l) => !inside(l.recorded_at)),
        events: state.events.filter((e) => !inside(e.occurred_at)),
      };
    }
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Day entries with optimistic mutations: the screen updates instantly, the server
 * call runs in the background, and a failed call rolls the change back.
 */
export function useDayState(initial: Entries, reload: () => Promise<Entries | null>) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // What the server last gave us for the loaded stretch of days.
  const [loaded, setLoaded] = useState<Entries>(initial);
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setLoaded(initial);
  }
  const [entries, apply] = useOptimistic<Entries, Op>(loaded, reduce);

  function mutate(op: Op, call: () => Promise<Result>) {
    startTransition(async () => {
      apply(op);
      const res = await call();
      if (res.error) setError(res.error);
      // Re-read the stretch so the optimistic copy hands over to real rows.
      const fresh = await reload();
      if (fresh) setLoaded(fresh);
    });
  }

  const ops = {
    /** `endAt: null` = live action that keeps running until you end it. */
    addAction(
      type: ActionType,
      at: number,
      endAt: number | null = null,
      extra: { effort?: number | null; pain?: number | null; notes?: string | null } = {},
    ) {
      const id = crypto.randomUUID();
      const row: Action = {
        id,
        user_id: "",
        type_id: type.id,
        name: type.name,
        category: type.category,
        color: type.color,
        started_at: iso(at),
        ended_at: endAt === null ? null : iso(endAt),
        effort: extra.effort ?? null,
        pain: extra.pain ?? null,
        notes: extra.notes ?? null,
        created_at: iso(Date.now()),
        exercise_id: null,
        sets: null,
        reps: null,
        weight_kg: null,
        rest_sec: null,
      };
      mutate({ kind: "addAction", row }, () =>
        addAction({
          id,
          typeId: type.id,
          name: type.name,
          category: type.category,
          color: type.color,
          at,
          endAt,
          effort: extra.effort ?? null,
          pain: extra.pain ?? null,
          notes: extra.notes ?? null,
        }),
      );
    },
    /** Timer field: end the running task (if any) and start the next one. */
    switchTask(type: ActionType, at: number, endId: string | null) {
      const id = crypto.randomUUID();
      const row: Action = {
        id,
        user_id: "",
        type_id: type.id,
        name: type.name,
        category: type.category,
        color: type.color,
        started_at: iso(at),
        ended_at: null,
        effort: null,
        pain: null,
        notes: null,
        created_at: iso(Date.now()),
        exercise_id: null,
        sets: null,
        reps: null,
        weight_kg: null,
        rest_sec: null,
      };
      startTransition(async () => {
        if (endId) apply({ kind: "patchAction", id: endId, patch: { ended_at: iso(at) } });
        apply({ kind: "addAction", row });
        const res = await switchTask({
          endId,
          id,
          typeId: type.id,
          name: type.name,
          category: type.category,
          color: type.color,
          at,
        });
        if (res.error) setError(res.error);
      });
    },
    setPain(id: string, pain: number | null) {
      mutate({ kind: "patchAction", id, patch: { pain } }, () => setActionPain({ id, pain }));
    },
    setNotes(id: string, notes: string | null) {
      mutate({ kind: "patchAction", id, patch: { notes } }, () => setActionNotes({ id, notes }));
    },
    /** Log an exercise from the library with the sets you actually did. */
    logExercise(
      exercise: Exercise,
      at: number,
      endAt: number | null,
      v: {
        sets: number | null;
        reps: number | null;
        weightKg: number | null;
        restSec: number | null;
        effort: number | null;
        pain: number | null;
        notes: string | null;
      },
    ) {
      const id = crypto.randomUUID();
      const row: Action = {
        id,
        user_id: "",
        type_id: null,
        name: exercise.name,
        category: "exercise",
        color: exercise.color,
        started_at: iso(at),
        ended_at: endAt === null ? null : iso(endAt),
        effort: v.effort,
        pain: v.pain,
        notes: v.notes,
        created_at: iso(Date.now()),
        exercise_id: exercise.id,
        sets: v.sets,
        reps: v.reps,
        weight_kg: v.weightKg,
        rest_sec: v.restSec,
      };
      mutate({ kind: "addAction", row }, () =>
        logExercise({ id, exerciseId: exercise.id, name: exercise.name, color: exercise.color, at, endAt, ...v }),
      );
    },
    endAction(id: string, at: number) {
      mutate({ kind: "patchAction", id, patch: { ended_at: iso(at) } }, () => endAction({ id, at }));
    },
    updateAction(id: string, v: { startedAt: number; endedAt: number | null; effort: number | null; pain?: number | null; notes: string | null }) {
      mutate(
        {
          kind: "patchAction",
          id,
          patch: {
            started_at: iso(v.startedAt),
            ended_at: v.endedAt === null ? null : iso(v.endedAt),
            effort: v.effort,
            pain: v.pain ?? null,
            notes: v.notes,
          },
        },
        () => updateAction({ id, ...v }),
      );
    },
    deleteAction(id: string) {
      mutate({ kind: "deleteAction", id }, () => deleteAction(id));
    },
    addLevel(level: number, at: number) {
      const id = crypto.randomUUID();
      mutate({ kind: "addLevel", row: { id, level, recorded_at: iso(at) } }, () => addPainLevel({ id, level, at }));
    },
    deleteLevel(id: string) {
      mutate({ kind: "deleteLevel", id }, () => deletePainLevel(id));
    },
    addEvent(type: PainType, at: number, intensity: number | null) {
      const id = crypto.randomUUID();
      const row: PainEvent = {
        id,
        user_id: "",
        type_id: type.id,
        name: type.name,
        color: type.color,
        occurred_at: iso(at),
        intensity,
        notes: null,
        created_at: iso(Date.now()),
      };
      mutate({ kind: "addEvent", row }, () =>
        addPainEvent({ id, typeId: type.id, name: type.name, color: type.color, at, intensity }),
      );
    },
    updateEvent(id: string, v: { at: number; intensity: number | null; notes: string | null }) {
      mutate(
        { kind: "patchEvent", id, patch: { occurred_at: iso(v.at), intensity: v.intensity, notes: v.notes } },
        () => updatePainEvent({ id, ...v }),
      );
    },
    deleteEvent(id: string) {
      mutate({ kind: "deleteEvent", id }, () => deletePainEvent(id));
    },
    clearDay(startMs: number, endMs: number) {
      mutate({ kind: "clearDay", startMs, endMs }, () => clearDay({ startMs, endMs }));
    },
  };

  /** Run a server action that is not part of the day entries (e.g. editing a type). */
  function call(fn: () => Promise<Result>) {
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  }

  return {
    entries,
    ops,
    call,
    /** Swap in a freshly loaded stretch (after scrolling further back). */
    replace: setLoaded,
    pending,
    error,
    clearError: () => setError(null),
  };
}
