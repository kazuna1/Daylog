"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Action, ActionType } from "@/lib/database.types";
import { formatDuration, formatTime } from "@/lib/time";
import { painColor } from "@/components/pain-badge";

const REMIND_EVERY_MS = 5 * 60_000;
/** How late an end timer may fire and still hand over to the next activity. */
const CATCH_UP_MS = 5 * 60_000;
// Longer than this and it was probably left running by mistake.
const STALE_MS = 12 * 60 * 60_000;

const BASE_TITLE = "Daylog";

const subscribeNothing = () => () => {};
const readPermission = (): NotificationPermission | "unsupported" =>
  "Notification" in window ? Notification.permission : "unsupported";

function clock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Short beep, no audio file needed. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc.start();
    osc.stop(ctx.currentTime + 0.62);
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // no audio available — the visual alert still fires
  }
}

function notify(title: string, body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, tag: "daylog-timer", renotify: true } as NotificationOptions);
    }
  } catch {
    // notifications blocked — panel still turns red
  }
}

/**
 * The timer field: tap a task to start it (and end the previous one). Each task
 * carries two independent timers — one that only notifies you, and one that ends
 * the activity and can start the next one by itself.
 */
export function TimerField({
  tz,
  types,
  running,
  now,
  onSwitch,
  onStop,
  onAutoEnd,
  onFixEnd,
  onPain,
  onNotes,
}: {
  tz: string;
  types: ActionType[];
  /** The action currently running, if any. */
  running: Action | null;
  now: number;
  onSwitch: (type: ActionType) => void;
  onStop: () => void;
  /** An end timer ran out: end at `at`, then start `nextTypeId` if there is one. */
  onAutoEnd: (at: number, nextTypeId: string | null) => void;
  /** Open the form to set the real end time of a forgotten action. */
  onFixEnd: () => void;
  onPain: (pain: number | null) => void;
  onNotes: (notes: string) => void;
}) {
  const [tick, setTick] = useState(now);
  const browserPermission = useSyncExternalStore(subscribeNothing, readPermission, () => "default" as const);
  // Note box and pain row follow whichever action is running.
  const [ui, setUi] = useState<{ id: string | null; note: string; showPain: boolean }>({
    id: running?.id ?? null,
    note: running?.notes ?? "",
    showPain: false,
  });
  if (ui.id !== (running?.id ?? null)) {
    setUi({ id: running?.id ?? null, note: running?.notes ?? "", showPain: false });
  }
  const { note, showPain } = ui;
  const setNote = (text: string) => setUi((u) => ({ ...u, note: text }));
  const setShowPain = (v: boolean) => setUi((u) => ({ ...u, showPain: v }));
  const alerted = useRef<{ id: string; at: number } | null>(null);
  const autoEnded = useRef<string | null>(null);
  const tasks = types.filter((t) => t.timer && !t.archived);
  const byId = (id: string | null | undefined) => (id ? types.find((t) => t.id === id) ?? null : null);
  const runningType = running ? byId(running.type_id) : null;
  const startedMs = running ? new Date(running.started_at).getTime() : 0;
  const elapsed = running ? tick - startedMs : 0;

  // The nudge: alerts, then lets the activity run on.
  const notifyMs = runningType?.limit_min ? runningType.limit_min * 60_000 : null;
  const leftToNotify = notifyMs === null ? null : notifyMs - elapsed;
  const over = leftToNotify !== null && leftToNotify <= 0;

  // The hard stop: ends the activity, and hands over when a follow-on is set.
  const endMs = runningType?.end_min ? runningType.end_min * 60_000 : null;
  const leftToEnd = endMs === null ? null : endMs - elapsed;
  const dueAt = running && endMs !== null ? startedMs + endMs : null;
  const nextType = runningType?.next_type_id ? byId(runningType.next_type_id) : null;
  const nextLive = nextType && !nextType.archived ? nextType : null;

  // Second-by-second clock while something runs.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Alert once when the notify threshold is passed, then every 5 min until you switch.
  useEffect(() => {
    if (!running || !over || !runningType) {
      if (!over) alerted.current = null;
      return;
    }
    const last = alerted.current;
    const due = !last || last.id !== running.id || tick - last.at >= REMIND_EVERY_MS;
    if (!due) return;
    alerted.current = { id: running.id, at: tick };
    const mins = Math.round(elapsed / 60000);
    beep();
    notify(`${runningType.name} — ${mins} min`, `You asked to be told after ${runningType.limit_min} min.`);
  }, [over, running, runningType, tick, elapsed]);

  // End timer: stop the activity at the moment you set, and start the next one.
  useEffect(() => {
    if (!running || !runningType || dueAt === null || tick < dueAt) return;
    if (autoEnded.current === running.id) return;
    autoEnded.current = running.id;
    // The tab may have been asleep for hours. Ending at the time you set is
    // always right, but only hand over if it just happened — otherwise we would
    // log a chain of activities you never did.
    const next = Date.now() - dueAt > CATCH_UP_MS ? null : nextLive;
    beep();
    notify(
      `${runningType.name} — time's up`,
      next ? `Ended after ${runningType.end_min} min · ${next.name} is now running.` : `Ended after ${runningType.end_min} min.`,
    );
    onAutoEnd(Math.min(dueAt, Date.now()), next?.id ?? null);
  }, [running, runningType, dueAt, tick, nextLive, onAutoEnd]);

  // The big number counts down to the hard stop when there is one, otherwise to
  // the nudge (and on into minus), otherwise it just counts up.
  const bigClock =
    leftToEnd !== null
      ? clock(Math.max(0, leftToEnd))
      : leftToNotify !== null
        ? over
          ? `-${clock(-leftToNotify)}`
          : clock(leftToNotify)
        : clock(elapsed);

  // Show the timer in the browser tab, so you can read it without switching back.
  useEffect(() => {
    if (!running) {
      document.title = BASE_TITLE;
      return;
    }
    const label = runningType?.emoji ? `${runningType.emoji} ${running.name}` : running.name;
    document.title = `${over ? "⏰ " : ""}${bigClock} · ${label}`;
    return () => {
      document.title = BASE_TITLE;
    };
  }, [running, runningType, bigClock, over]);

  const stale = running !== null && elapsed > STALE_MS;
  // The bar drains as the remaining time runs out, then sits full red.
  const progress =
    endMs !== null && leftToEnd !== null
      ? Math.max(0, leftToEnd / endMs)
      : notifyMs !== null && leftToNotify !== null
        ? over
          ? 1
          : Math.max(0, leftToNotify / notifyMs)
        : 0;
  const hasBar = endMs !== null || notifyMs !== null;
  const alerts = browserPermission;

  return (
    <section
      data-testid="timer-field"
      className={`flex shrink-0 flex-col gap-2 rounded-3xl border p-2.5 transition ${
        over ? "animate-pulse border-[var(--pain-max)] bg-[var(--pain-max)]/10" : "border-line bg-surface"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold tracking-wider text-muted uppercase">Focus timer</h2>
        {alerts === "denied" && (
          <span className="text-[11px] text-muted" title="Allow notifications for this site in your browser settings">
            🔕 alerts blocked
          </span>
        )}
      </div>

      {running && (
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `${running.color}22` }}>
              {runningType?.emoji ?? "▶"}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {running.name}
                <span className="ml-2 font-normal text-muted">since {formatTime(tz, running.started_at)}</span>
              </p>
              <p className="flex items-baseline gap-2">
                <span
                  className="text-2xl leading-tight font-semibold tabular-nums"
                  style={over ? { color: "var(--pain-max)" } : undefined}
                >
                  {bigClock}
                </span>
                {runningType && (
                  <span
                    className={`truncate text-xs tabular-nums ${over ? "font-semibold text-[var(--pain-max)]" : "text-muted"}`}
                  >
                    {clock(elapsed)} so far
                    {notifyMs !== null &&
                      (over ? ` · 🔔 past ${runningType.limit_min}m` : ` · 🔔 in ${clock(leftToNotify!)}`)}
                    {dueAt !== null && ` · ⏹ ends ${formatTime(tz, dueAt)}`}
                    {nextLive && ` → ${nextLive.emoji ?? ""} ${nextLive.name}`}
                    {notifyMs === null && endMs === null && " · no timers"}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setShowPain(!showPain)}
              className="h-9 rounded-lg border border-line px-2.5 text-xs font-medium"
              style={running.pain !== null ? { background: painColor(running.pain), color: "#fff", borderColor: "transparent" } : undefined}
            >
              {running.pain !== null ? `pain ${running.pain}` : "+ pain"}
            </button>
            <button onClick={onStop} className="h-9 rounded-lg border border-line px-3 text-xs font-medium">
              Stop
            </button>
          </div>
        </div>
      )}

      {stale && running && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--pain-max)]/10 px-3 py-2 text-sm">
          <span>
            <b>{running.name}</b> has been running for {formatDuration(elapsed)} — did you forget to end it?
          </span>
          <button onClick={onFixEnd} className="btn-primary ml-auto px-3 py-1.5 text-xs">
            Fix the end time
          </button>
        </div>
      )}

      {hasBar && running && (
        <div className="h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full transition-[width] duration-1000"
            style={{ width: `${progress * 100}%`, background: over ? "var(--pain-max)" : "var(--accent)" }}
          />
        </div>
      )}

      {showPain && running && (
        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-11 gap-1">
            {Array.from({ length: 11 }, (_, n) => (
              <button
                key={n}
                onClick={() => onPain(running.pain === n ? null : n)}
                className="h-9 rounded-lg text-sm font-semibold text-white tabular-nums"
                style={{
                  background: painColor(n),
                  outline: running.pain === n ? "3px solid var(--ink)" : undefined,
                  outlineOffset: 1,
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <input
            className="input py-2 text-sm"
            placeholder="Note for this activity — e.g. pain rose after 20 min"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (running.notes ?? "") && onNotes(note)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      )}

      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
        {tasks.map((t) => {
          const active = running?.type_id === t.id;
          const follows = byId(t.next_type_id);
          return (
            <button
              key={t.id}
              onClick={() => onSwitch(t)}
              title={[
                t.limit_min && `Notifies after ${t.limit_min} min`,
                t.end_min && `Ends after ${t.end_min} min${follows ? ` and starts ${follows.name}` : ""}`,
              ]
                .filter(Boolean)
                .join(" · ") || t.name}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-2 text-sm font-medium transition active:scale-95 ${
                active ? "border-transparent text-white" : "border-line bg-surface hover:bg-surface-2"
              }`}
              style={active ? { background: t.color } : undefined}
            >
              <span>{t.emoji ?? "•"}</span>
              <span className="whitespace-nowrap">{t.name}</span>
              {t.limit_min && (
                <span className={`text-[10px] tabular-nums ${active ? "opacity-80" : "text-muted"}`}>🔔{t.limit_min}m</span>
              )}
              {t.end_min && (
                <span className={`text-[10px] tabular-nums ${active ? "opacity-80" : "text-muted"}`}>
                  ⏹{t.end_min}m{follows ? `→${follows.emoji ?? "▸"}` : ""}
                </span>
              )}
            </button>
          );
        })}
        {tasks.length === 0 && (
          <p className="text-xs text-muted">
            No activities on the bar yet — add them in{" "}
            <a className="underline underline-offset-2" href="/configuration">
              Configuration
            </a>
            .
          </p>
        )}
      </div>
    </section>
  );
}
