"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DayData } from "@/lib/day-data";
import { clipActions, packLanes, painSeries, type PainPoint } from "@/lib/day";
import { addDays, formatDay, formatDuration, formatTime, localDay, minutesOfDay } from "@/lib/time";
import { useDayState } from "./use-day-state";
import { removeTimerTask, saveTimerTask } from "@/app/(app)/timeline-actions";
import { Sky } from "./sky";
import { Timeline, type ContextRequest, type Target } from "./timeline";
import { saveViewHours } from "@/lib/view";
import { ContextMenu, type MenuHandlers } from "./context-menu";
import { ActionSheet, EndActionSheet, ExerciseSheet, NewActionSheet, PainEventSheet } from "./sheets";
import { ConfirmDialog } from "@/components/dialog";
import { PainBar } from "./pain-bar";
import { TimerField } from "./timer-field";

const TICK_MS = 20_000;

export function DayView({
  data,
  tz,
  isToday,
  serverNow,
  viewHours: initialViewHours,
}: {
  data: DayData;
  tz: string;
  isToday: boolean;
  serverNow: number;
  viewHours: number;
}) {
  const [now, setNow] = useState(serverNow);
  const [menu, setMenu] = useState<ContextRequest | null>(null);
  const [sheet, setSheet] = useState<Target | null>(null);
  const [viewHours, setViewHours] = useState(initialViewHours);
  const changeViewHours = useCallback((h: number) => {
    setViewHours(h);
    saveViewHours(h);
  }, []);
  const [draft, setDraft] = useState<{ level: number; at: number } | null>(null);
  // Manual logging form and the erase-day confirmation.
  const [manual, setManual] = useState<{ from: number; to: number | null } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // Ending a forgotten action at a time typed by hand.
  const [ending, setEnding] = useState<{ id: string; at: number } | null>(null);
  // Logging an exercise from the library at a given time.
  const [loggingExercise, setLoggingExercise] = useState<{ id: string; at: number } | null>(null);
  const { entries, ops, call, pending, error, clearError } = useDayState(data);

  const router = useRouter();

  // Tick the clock; when midnight passes, reload so Today starts empty.
  useEffect(() => {
    if (!isToday) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (localDay(tz, new Date(t)) !== data.day) router.refresh();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [isToday, tz, data.day, router]);

  // Pick up entries logged from another device when coming back to the tab.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [router]);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(clearError, 4000);
    return () => clearTimeout(id);
  }, [error, clearError]);

  const span = useMemo(() => ({ startMs: data.startMs, endMs: data.endMs }), [data.startMs, data.endMs]);
  const liveNow = isToday ? now : null;
  const { actions, events } = entries;
  const clipped = useMemo(() => clipActions(actions, span, isToday ? now : span.endMs), [actions, span, now, isToday]);
  const lanes = useMemo(() => packLanes(clipped, 2), [clipped]);
  // While the glider moves, show the new level live before it is saved.
  const levels = useMemo(
    () => (draft ? [...entries.levels, { id: "draft", level: draft.level, recorded_at: new Date(draft.at).toISOString() }] : entries.levels),
    [entries.levels, draft],
  );
  const painPoints: PainPoint[] = useMemo(() => painSeries(levels, span), [levels, span]);
  const typeById = useMemo(() => new Map(data.actionTypes.map((t) => [t.id, t])), [data.actionTypes]);
  const exerciseById = useMemo(() => new Map(data.exercises.map((e) => [e.id, e])), [data.exercises]);
  // Actions carry either a type (activities) or an exercise; both can have an emoji.
  const emojiFor = useCallback(
    (a: { type_id: string | null; exercise_id?: string | null }) =>
      (a.type_id ? typeById.get(a.type_id)?.emoji : null) ??
      (a.exercise_id ? exerciseById.get(a.exercise_id)?.emoji ?? "🏋️" : null) ??
      null,
    [typeById, exerciseById],
  );
  const running = actions.filter((a) => a.ended_at === null);
  // The timer field follows the most recently started running action.
  const current = running.length
    ? running.reduce((a, b) => (a.started_at >= b.started_at ? a : b))
    : null;
  const savedPain = painSeries(entries.levels, span).at(-1)?.level ?? null;

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
      return a ? `${emojiFor(a) ?? ""} ${a.name} · ${formatTime(tz, a.started_at)}–${a.ended_at ? formatTime(tz, a.ended_at) : "now"}` : null;
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

  const skyMinute = isToday ? minutesOfDay(tz, new Date(now)) : 13 * 60;
  const todayKey = localDay(tz, new Date(now));
  const prevDay = addDays(data.day, -1);
  const nextDay = addDays(data.day, 1);

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-[1600px] flex-col gap-3 px-3 pt-1 pb-3 sm:px-5">
      {/* top ~25%: sky */}
      <div className="h-[20%] max-h-56 min-h-32 shrink-0">
        <Sky
          minuteOfDay={skyMinute}
          live={isToday}
          clock={isToday ? formatTime(tz, now) : formatDay(data.day, { weekday: "long" })}
          dateLabel={isToday ? formatDay(data.day, { weekday: "long", month: "long" }) : String(new Date(data.startMs).getUTCFullYear())}
        >
          <div className="flex flex-wrap items-center gap-2">
            {isToday
              ? running.map((a) => (
                  <span key={a.id} className="flex items-center gap-2 rounded-full bg-black/20 py-1 pr-1 pl-3 text-sm backdrop-blur">
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
                ))
              : null}
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Link
              href={`/day/${prevDay}`}
              aria-label="Previous day"
              title="Previous day"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/20 text-xl leading-none backdrop-blur transition hover:bg-black/35"
            >
              ‹
            </Link>

            <span className="rounded-full bg-black/20 px-4 py-2 text-base font-semibold whitespace-nowrap backdrop-blur">
              {isToday ? "Today" : formatDay(data.day)}
            </span>

            {isToday ? (
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/10 text-xl leading-none opacity-30"
              >
                ›
              </span>
            ) : (
              <Link
                href={nextDay >= todayKey ? "/" : `/day/${nextDay}`}
                aria-label="Next day"
                title="Next day"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/20 text-xl leading-none backdrop-blur transition hover:bg-black/35"
              >
                ›
              </Link>
            )}

            {!isToday && (
              <Link
                href="/"
                className="rounded-full bg-white/85 px-3 py-2 text-sm font-semibold text-black transition hover:bg-white"
              >
                Today
              </Link>
            )}
          </div>
        </Sky>
      </div>

      {isToday && (
        <TimerField
          tz={tz}
          types={data.actionTypes}
          running={current}
          now={now}
          onSwitch={(type) => ops.switchTask(type, Date.now(), current?.id ?? null)}
          onStop={() => current && ops.endAction(current.id, Date.now())}
          onAutoEnd={autoEnd}
          onFixEnd={() =>
            current && setEnding({ id: current.id, at: new Date(current.started_at).getTime() + 3_600_000 })
          }
          onPain={(pain) => current && ops.setPain(current.id, pain)}
          onNotes={(notes) => current && ops.setNotes(current.id, notes)}
          onSaveTask={(v) => call(() => saveTimerTask(v))}
          onRemoveTask={(id) => call(() => removeTimerTask(id))}
          pending={pending}
        />
      )}

      {/* ~60%: timeline */}
      <div className="relative min-h-0 flex-1">
        <Timeline
          tz={tz}
          day={span}
          now={liveNow}
          lanes={lanes}
          events={events}
          painPoints={painPoints}
          emojiFor={emojiFor}
          viewHours={viewHours}
          onViewHoursChange={changeViewHours}
          onContext={setMenu}
          onOpen={(t) => (t.kind === "level" ? setMenu(null) : setSheet(t))}
          onClearDay={() => setConfirmClear(true)}
        />
        {pending && (
          <span className="absolute right-3 bottom-2 z-20 rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted shadow">
            saving…
          </span>
        )}
      </div>

      {/* bottom: pain glider */}
      {isToday ? (
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
      ) : (
        <div className="flex shrink-0 items-center justify-center gap-3">
          <button
            onClick={() => setManual({ from: data.startMs + 12 * 3600000, to: data.startMs + 12.5 * 3600000 })}
            className="btn-ghost px-3 py-2 text-sm"
          >
            + Add action
          </button>
          <p className="text-xs text-muted">
            or drag across the timeline · right-click for more
          </p>
        </div>
      )}

      {menu && (
        <ContextMenu
          key={`${menu.x}-${menu.y}-${menu.at}`}
          tz={tz}
          req={menu}
          now={liveNow}
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
          title={`Erase ${isToday ? "today" : formatDay(data.day)}?`}
          confirmLabel="Yes, erase"
          pending={pending}
          onClose={() => setConfirmClear(false)}
          onConfirm={() => {
            ops.clearDay(data.startMs, data.endMs);
            setConfirmClear(false);
          }}
          body={
            <>
              <p>This deletes everything logged on this day:</p>
              <ul className="mt-2 ml-4 list-disc">
                <li>{actions.length} action{actions.length === 1 ? "" : "s"}</li>
                <li>{entries.levels.length} pain reading{entries.levels.length === 1 ? "" : "s"}</li>
                <li>{events.length} pain event{events.length === 1 ? "" : "s"}</li>
              </ul>
              <p className="mt-2 text-muted">This cannot be undone.</p>
            </>
          }
        />
      )}

      {error && (
        <div role="alert" className="fixed inset-x-0 bottom-24 z-50 mx-auto w-max max-w-[90vw] rounded-full bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}
