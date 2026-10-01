"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TimelineData } from "@/lib/day-data";
import { clipActions, packLanes, painSeries, type PainPoint } from "@/lib/day";
import { addDays, dayBoundsMs, formatDay, formatDuration, formatTime, localDay, minutesOfDay } from "@/lib/time";
import { useDayState } from "./use-day-state";
import { fetchEntries, removeTimerTask, saveTimerTask } from "@/app/(app)/timeline-actions";
import { Sky } from "./sky";
import { Timeline, type ContextRequest, type DayMark, type Target, type TimelineHandle } from "./timeline";
import { saveViewHours } from "@/lib/view";
import { ContextMenu, type MenuHandlers } from "./context-menu";
import { ActionSheet, EndActionSheet, ExerciseSheet, NewActionSheet, PainEventSheet } from "./sheets";
import { ConfirmDialog } from "@/components/dialog";
import { PainBar } from "./pain-bar";
import { TimerField } from "./timer-field";

const TICK_MS = 20_000;
/** Days added each time you scroll near an edge. */
const EXTEND_BY = 3;
/** Stop growing the strip here; All days is the way to jump further. */
const MAX_DAYS = 90;

function daysApart(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function DayView({
  data,
  tz,
  focusDay: initialFocusDay,
  serverNow,
  viewHours: initialViewHours,
}: {
  data: TimelineData;
  tz: string;
  /** The day the page was opened on. */
  focusDay: string;
  serverNow: number;
  viewHours: number;
}) {
  const [now, setNow] = useState(serverNow);
  const [menu, setMenu] = useState<ContextRequest | null>(null);
  const [sheet, setSheet] = useState<Target | null>(null);
  const [viewHours, setViewHours] = useState(initialViewHours);
  const [draft, setDraft] = useState<{ level: number; at: number } | null>(null);
  const [manual, setManual] = useState<{ from: number; to: number | null } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [ending, setEnding] = useState<{ id: string; at: number } | null>(null);
  const [loggingExercise, setLoggingExercise] = useState<{ id: string; at: number } | null>(null);

  // The stretch of days currently loaded, and the day the view is centred on.
  const [range, setRange] = useState({ fromDay: data.fromDay, toDay: data.toDay });
  const [lastData, setLastData] = useState(data);
  if (data !== lastData) {
    setLastData(data);
    setRange({ fromDay: data.fromDay, toDay: data.toDay });
  }
  const [focusDay, setFocusDay] = useState(initialFocusDay);
  const [loading, setLoading] = useState(false);
  const rangeRef = useRef(range);
  const busy = useRef(false);
  const timeline = useRef<TimelineHandle | null>(null);

  useEffect(() => {
    rangeRef.current = range;
  }, [range]);

  const reload = useCallback(async () => {
    const res = await fetchEntries(rangeRef.current);
    return res.data ?? null;
  }, []);

  const { entries, ops, call, replace, pending, error, clearError } = useDayState(
    useMemo(() => ({ actions: data.actions, levels: data.levels, events: data.events }), [data]),
    reload,
  );

  const todayKey = localDay(tz, new Date(now));
  const span = useMemo(
    () => ({ startMs: dayBoundsMs(tz, range.fromDay).start, endMs: dayBoundsMs(tz, range.toDay).end }),
    [tz, range.fromDay, range.toDay],
  );
  const days: DayMark[] = useMemo(() => {
    const out: DayMark[] = [];
    for (let d = range.fromDay; d <= range.toDay; d = addDays(d, 1)) {
      const { start, end } = dayBoundsMs(tz, d);
      out.push({ day: d, startMs: start, endMs: end });
    }
    return out;
  }, [tz, range.fromDay, range.toDay]);

  /** Scrolled near an edge: pull in more days and keep the view where it is. */
  const needMore = useCallback(
    async (side: "past" | "future") => {
      if (busy.current) return;
      const cur = rangeRef.current;
      const today = localDay(tz, new Date());
      const next =
        side === "past"
          ? { ...cur, fromDay: addDays(cur.fromDay, -EXTEND_BY) }
          : { ...cur, toDay: addDays(cur.toDay, EXTEND_BY) };

      if (side === "past" && daysApart(next.fromDay, cur.toDay) > MAX_DAYS) return;
      // Never load past tomorrow — there is nothing logged in the future.
      if (side === "future" && cur.toDay >= addDays(today, 1)) return;
      if (side === "future" && next.toDay > addDays(today, 1)) next.toDay = addDays(today, 1);

      busy.current = true;
      setLoading(true);
      const res = await fetchEntries(next);
      if (res.data) {
        setRange(next);
        replace(res.data);
      }
      busy.current = false;
      setLoading(false);
    },
    [tz, replace],
  );

  // Tick the clock, and roll the strip forward when midnight passes.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const today = localDay(tz, new Date(t));
      if (today > rangeRef.current.toDay) needMore("future");
    }, TICK_MS);
    return () => clearInterval(id);
  }, [tz, needMore]);

  // Pick up entries logged on another device when you come back to the tab.
  useEffect(() => {
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      const fresh = await reload();
      if (fresh) replace(fresh);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload, replace]);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(clearError, 4000);
    return () => clearTimeout(id);
  }, [error, clearError]);

  const changeViewHours = useCallback((h: number) => {
    setViewHours(h);
    saveViewHours(h);
  }, []);

  const { actions, events } = entries;
  const clipped = useMemo(() => clipActions(actions, span, now), [actions, span, now]);
  const lanes = useMemo(() => packLanes(clipped, 2), [clipped]);
  // While the glider moves, show the new level live before it is saved.
  const levels = useMemo(
    () =>
      draft
        ? [...entries.levels, { id: "draft", level: draft.level, recorded_at: new Date(draft.at).toISOString() }]
        : entries.levels,
    [entries.levels, draft],
  );
  const painPoints: PainPoint[] = useMemo(() => painSeries(levels, span), [levels, span]);
  const typeById = useMemo(() => new Map(data.actionTypes.map((t) => [t.id, t])), [data.actionTypes]);
  const exerciseById = useMemo(() => new Map(data.exercises.map((e) => [e.id, e])), [data.exercises]);
  // Actions carry either a type (activities) or an exercise; both can have an emoji.
  const emojiFor = useCallback(
    (a: { type_id: string | null; exercise_id?: string | null }) =>
      (a.type_id ? typeById.get(a.type_id)?.emoji : null) ??
      (a.exercise_id ? (exerciseById.get(a.exercise_id)?.emoji ?? "🏋️") : null) ??
      null,
    [typeById, exerciseById],
  );
  const running = actions.filter((a) => a.ended_at === null);
  const current = running.length ? running.reduce((a, b) => (a.started_at >= b.started_at ? a : b)) : null;
  const savedPain =
    entries.levels.filter((l) => new Date(l.recorded_at).getTime() <= now).at(-1)?.level ?? null;

  const focusIsToday = focusDay === todayKey;
  const focusBounds = useMemo(() => dayBoundsMs(tz, focusDay), [tz, focusDay]);
  const focusLabel = focusIsToday ? "today" : formatDay(focusDay);

  /** Entries that belong to the day being erased, for the confirmation. */
  const inFocusDay = useMemo(() => {
    const inside = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= focusBounds.start && t < focusBounds.end;
    };
    return {
      actions: actions.filter(
        (a) =>
          new Date(a.started_at).getTime() < focusBounds.end &&
          (a.ended_at === null || new Date(a.ended_at).getTime() > focusBounds.start),
      ).length,
      levels: entries.levels.filter((l) => inside(l.recorded_at)).length,
      events: events.filter((e) => inside(e.occurred_at)).length,
    };
  }, [actions, entries.levels, events, focusBounds]);

  /** An end timer ran out: close the action, and start whatever follows it. */
  function autoEnd(at: number, nextTypeId: string | null) {
    if (!current) return;
    const next = nextTypeId ? typeById.get(nextTypeId) : null;
    if (next) ops.switchTask(next, at, current.id);
    else ops.endAction(current.id, at);
  }

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeSheet = useCallback(() => setSheet(null), []);

  function removeTarget(t: Target) {
    if (t.kind === "action") ops.deleteAction(t.id);
    else if (t.kind === "event") ops.deleteEvent(t.id);
    else if (t.id !== "draft") ops.deleteLevel(t.id);
  }

  const handlers: MenuHandlers = {
    start: (typeId, at) => {
      const type = typeById.get(typeId);
      if (type) ops.addAction(type, at);
    },
    addRange: (typeId, from, to) => {
      const type = typeById.get(typeId);
      if (type) ops.addAction(type, from, to);
    },
    manual: (from, to) => setManual({ from, to }),
    endAt: (actionId, at) => setEnding({ id: actionId, at }),
    exercise: (exerciseId, at) => setLoggingExercise({ id: exerciseId, at }),
    end: (id, at) => ops.endAction(id, at),
    painLevel: (level, at) => ops.addLevel(level, at),
    painEvent: (typeId, at, intensity) => {
      const type = data.painTypes.find((t) => t.id === typeId);
      if (type) ops.addEvent(type, at, intensity);
    },
    edit: (t) => setSheet(t),
    remove: removeTarget,
  };

  function targetLabel(t: Target | null) {
    if (!t) return null;
    if (t.kind === "action") {
      const a = actions.find((x) => x.id === t.id);
      return a
        ? `${emojiFor(a) ?? ""} ${a.name} · ${formatTime(tz, a.started_at)}–${a.ended_at ? formatTime(tz, a.ended_at) : "now"}`
        : null;
    }
    if (t.kind === "event") {
      const e = events.find((x) => x.id === t.id);
      return e ? `${e.name} · ${formatTime(tz, e.occurred_at)}` : null;
    }
    const p = painPoints.find((x) => x.id === t.id);
    return p ? `Pain ${p.level} · ${formatTime(tz, p.at)}` : null;
  }

  function openQuickMenu(e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.left - 200, y: r.top - 420, at: Math.floor(Date.now() / 60000) * 60000, target: null });
  }

  const sheetAction = sheet?.kind === "action" ? actions.find((a) => a.id === sheet.id) : null;
  const sheetEvent = sheet?.kind === "event" ? events.find((e) => e.id === sheet.id) : null;

  const stepperBtn =
    "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/20 text-xl leading-none backdrop-blur transition hover:bg-black/35";

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-[1600px] flex-col gap-3 px-3 pt-1 pb-3 sm:px-5">
      {/* top: sky, following whichever day is on screen */}
      <div className="h-[20%] max-h-56 min-h-32 shrink-0">
        <Sky
          minuteOfDay={focusIsToday ? minutesOfDay(tz, new Date(now)) : 13 * 60}
          live={focusIsToday}
          clock={focusIsToday ? formatTime(tz, now) : formatDay(focusDay, { weekday: "long" })}
          dateLabel={formatDay(focusDay, { weekday: "long", month: "long" })}
        >
          <div className="flex flex-wrap items-center gap-2">
            {running.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-2 rounded-full bg-black/20 py-1 pr-1 pl-3 text-sm backdrop-blur"
              >
                <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: a.color }} />
                {emojiFor(a)} {a.name}
                <span className="tabular-nums opacity-80">{formatDuration(now - new Date(a.started_at).getTime())}</span>
                <button
                  onClick={() => ops.endAction(a.id, Date.now())}
                  className="rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-black"
                >
                  End
                </button>
              </span>
            ))}
          </div>

          {/* The strip scrolls through days on its own; these just jump a day at a time. */}
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => timeline.current?.shiftDays(-1)} aria-label="Previous day" title="Previous day" className={stepperBtn}>
              ‹
            </button>

            <span className="rounded-full bg-black/20 px-4 py-2 text-base font-semibold whitespace-nowrap backdrop-blur">
              {focusIsToday ? "Today" : formatDay(focusDay)}
            </span>

            {focusIsToday ? (
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/10 text-xl leading-none opacity-30">
                ›
              </span>
            ) : (
              <button onClick={() => timeline.current?.shiftDays(1)} aria-label="Next day" title="Next day" className={stepperBtn}>
                ›
              </button>
            )}

            {!focusIsToday && (
              <button
                onClick={() => timeline.current?.centerOn(now - (viewHours / 6) * 3_600_000)}
                className="rounded-full bg-white/85 px-3 py-2 text-sm font-semibold text-black transition hover:bg-white"
              >
                Today
              </button>
            )}
          </div>
        </Sky>
      </div>

      <TimerField
        tz={tz}
        types={data.actionTypes}
        running={current}
        now={now}
        onSwitch={(type) => ops.switchTask(type, Date.now(), current?.id ?? null)}
        onStop={() => current && ops.endAction(current.id, Date.now())}
        onAutoEnd={autoEnd}
        onFixEnd={() => current && setEnding({ id: current.id, at: new Date(current.started_at).getTime() + 3_600_000 })}
        onPain={(pain) => current && ops.setPain(current.id, pain)}
        onNotes={(notes) => current && ops.setNotes(current.id, notes)}
        onSaveTask={(v) => call(() => saveTimerTask(v))}
        onRemoveTask={(id) => call(() => removeTimerTask(id))}
        pending={pending}
      />

      {/* the continuous strip */}
      <div className="relative min-h-0 flex-1">
        <Timeline
          tz={tz}
          span={span}
          days={days}
          now={now}
          lanes={lanes}
          events={events}
          painPoints={painPoints}
          emojiFor={emojiFor}
          viewHours={viewHours}
          onViewHoursChange={changeViewHours}
          onContext={setMenu}
          onOpen={(t) => (t.kind === "level" ? setMenu(null) : setSheet(t))}
          onClearDay={() => setConfirmClear(true)}
          clearDayLabel={focusLabel}
          onVisibleChange={({ centerMs }) => {
            const d = localDay(tz, new Date(centerMs));
            setFocusDay((prev) => (prev === d ? prev : d));
          }}
          onNeedMore={needMore}
          loading={loading}
          initialCenterMs={
            initialFocusDay === todayKey
              ? now - (initialViewHours / 6) * 3_600_000
              : dayBoundsMs(tz, initialFocusDay).start + 13 * 3_600_000
          }
          handle={timeline}
        />
        {pending && (
          <span className="absolute right-3 bottom-2 z-20 rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted shadow">
            saving…
          </span>
        )}
      </div>

      {/* bottom: pain glider */}
      <div className="shrink-0">
        <PainBar
          current={savedPain}
          onDraft={(level) => setDraft({ level, at: Date.now() })}
          onCommit={(level) => {
            if (level !== savedPain) ops.addLevel(level, Date.now());
            setDraft(null);
          }}
        >
          <button onClick={openQuickMenu} className="btn-primary px-3 py-2 text-sm whitespace-nowrap">
            ▶ Start
          </button>
          <button
            onClick={() => setManual({ from: Math.floor((Date.now() - 30 * 60000) / 60000) * 60000, to: Date.now() })}
            className="btn-ghost px-3 py-2 text-sm whitespace-nowrap"
          >
            + Add…
          </button>
        </PainBar>
      </div>

      {menu && (
        <ContextMenu
          key={`${menu.x}-${menu.y}-${menu.at}`}
          tz={tz}
          req={menu}
          now={now}
          actions={actions}
          actionTypes={data.actionTypes}
          painTypes={data.painTypes}
          exercises={data.exercises}
          targetLabel={targetLabel(menu.target)}
          onClose={closeMenu}
          handlers={handlers}
        />
      )}

      {sheetAction && (
        <ActionSheet
          key={sheetAction.id}
          tz={tz}
          action={sheetAction}
          emoji={emojiFor(sheetAction)}
          pending={pending}
          onClose={closeSheet}
          onSave={(v) => {
            ops.updateAction(sheetAction.id, v);
            closeSheet();
          }}
          onDelete={() => {
            ops.deleteAction(sheetAction.id);
            closeSheet();
          }}
        />
      )}

      {sheetEvent && (
        <PainEventSheet
          key={sheetEvent.id}
          tz={tz}
          event={sheetEvent}
          pending={pending}
          onClose={closeSheet}
          onSave={(v) => {
            ops.updateEvent(sheetEvent.id, v);
            closeSheet();
          }}
          onDelete={() => {
            ops.deleteEvent(sheetEvent.id);
            closeSheet();
          }}
        />
      )}

      {ending &&
        (() => {
          const a = actions.find((x) => x.id === ending.id);
          if (!a) return null;
          return (
            <EndActionSheet
              key={a.id}
              tz={tz}
              action={a}
              emoji={emojiFor(a)}
              defaultAt={Math.max(ending.at, new Date(a.started_at).getTime())}
              now={now}
              pending={pending}
              onClose={() => setEnding(null)}
              onEnd={(at) => {
                ops.endAction(a.id, at);
                setEnding(null);
              }}
            />
          );
        })()}

      {loggingExercise &&
        (() => {
          const ex = data.exercises.find((e) => e.id === loggingExercise.id);
          if (!ex) return null;
          return (
            <ExerciseSheet
              key={ex.id}
              tz={tz}
              exercise={ex}
              at={loggingExercise.at}
              now={now}
              pending={pending}
              onClose={() => setLoggingExercise(null)}
              onLog={(from, to, v) => {
                ops.logExercise(ex, from, to, v);
                setLoggingExercise(null);
              }}
            />
          );
        })()}

      {manual && (
        <NewActionSheet
          tz={tz}
          types={data.actionTypes}
          from={manual.from}
          to={manual.to}
          pending={pending}
          onClose={() => setManual(null)}
          onCreate={(type, from, to, extra) => {
            ops.addAction(type, from, to, extra);
            setManual(null);
          }}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title={`Erase ${focusLabel}?`}
          confirmLabel="Yes, erase"
          pending={pending}
          onClose={() => setConfirmClear(false)}
          onConfirm={() => {
            ops.clearDay(focusBounds.start, focusBounds.end);
            setConfirmClear(false);
          }}
          body={
            <>
              <p>This deletes everything logged on {focusIsToday ? "today" : formatDay(focusDay)}:</p>
              <ul className="mt-2 ml-4 list-disc">
                <li>
                  {inFocusDay.actions} action{inFocusDay.actions === 1 ? "" : "s"}
                </li>
                <li>
                  {inFocusDay.levels} pain reading{inFocusDay.levels === 1 ? "" : "s"}
                </li>
                <li>
                  {inFocusDay.events} pain event{inFocusDay.events === 1 ? "" : "s"}
                </li>
              </ul>
              <p className="mt-2 text-muted">This cannot be undone.</p>
            </>
          }
        />
      )}

      {error && (
        <div
          role="alert"
          className="fixed inset-x-0 bottom-24 z-50 mx-auto w-max max-w-[90vw] rounded-full bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
        >
          {error}
        </div>
      )}
    </div>
  );
}
