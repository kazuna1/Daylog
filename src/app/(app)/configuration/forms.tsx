"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionType, Exercise, PainType } from "@/lib/database.types";
import { Sheet } from "@/components/dialog";
import {
  addToTimerBar,
  deleteType,
  moveTimerTask,
  removeFromTimerBar,
  deleteExercise,
  saveActionType,
  saveExercise,
  savePainType,
  setExerciseArchived,
  saveTimerSettings,
  setArchived,
  type FormState,
} from "./actions";

function Status({ state, pending }: { state: FormState; pending: boolean }) {
  if (pending) return <span className="text-xs text-muted">Saving…</span>;
  if (state?.error) return <span className="text-xs text-red-600">{state.error}</span>;
  if (state?.ok) return <span className="text-xs text-emerald-700">Saved</span>;
  return null;
}

// ---- delete ---------------------------------------------------------------

/** Submits its own form, so the dialog can show that the delete is in flight. */
function SubmitButton({ className, children }: { className: string; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending}>
      {pending ? "…" : children}
    </button>
  );
}

/**
 * Deleting a type is permanent, so it asks first — and offers archiving, which
 * is what most people actually want.
 */
function DeleteDialog({
  table,
  id,
  name,
  archived,
  onBar,
  usedBy,
  onClose,
}: {
  table: "action_types" | "pain_types";
  id: string;
  name: string;
  archived: boolean;
  onBar: boolean;
  usedBy: string[];
  onClose: () => void;
}) {
  const noun = table === "action_types" ? "action" : "pain type";
  const logged = table === "action_types" ? "Actions" : "Pain events";

  return (
    <Sheet
      onClose={onClose}
      title={
        <>
          Delete <span className="font-bold">{name}</span>?
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <ul className="ml-4 list-disc space-y-1">
          <li>
            {logged} you have already logged as <span className="font-medium">{name}</span> keep their name and colour —
            nothing disappears from your timeline.
          </li>
          <li>
            The {noun} itself is gone, so you can no longer log it.
            {onBar && " It also leaves the timer bar."}
          </li>
          {usedBy.length > 0 && (
            <li className="text-red-600">
              {usedBy.length === 1 ? `${usedBy[0]} hands over to it` : `${usedBy.length} activities hand over to it`} when
              their end timer runs out — that hand-over is cleared.
            </li>
          )}
        </ul>
        <p className="text-muted">This cannot be undone.</p>

        <div className="flex gap-2">
          <button className="btn-ghost flex-1 py-3" onClick={onClose} autoFocus>
            No, keep it
          </button>
          {/* Closing afterwards matters for archiving, where the row stays put. */}
          <form
            action={async (fd) => {
              await deleteType(fd);
              onClose();
            }}
            className="flex-1"
          >
            <input type="hidden" name="table" value={table} />
            <input type="hidden" name="id" value={id} />
            <SubmitButton className="btn-danger w-full">Yes, delete</SubmitButton>
          </form>
        </div>

        {!archived && (
          <form
            action={async (fd) => {
              await setArchived(fd);
              onClose();
            }}
            className="border-t border-line pt-3"
          >
            <input type="hidden" name="table" value={table} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="archived" value="true" />
            <SubmitButton className="btn-ghost w-full py-2.5">Archive instead — hide it, keep it</SubmitButton>
          </form>
        )}
      </div>
    </Sheet>
  );
}

function RowButtons({
  table,
  id,
  name,
  archived,
  onBar = false,
  usedBy = [],
}: {
  table: "action_types" | "pain_types";
  id: string;
  name: string;
  archived: boolean;
  onBar?: boolean;
  usedBy?: string[];
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <form action={setArchived}>
        <input type="hidden" name="table" value={table} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="archived" value={String(!archived)} />
        <button className="row-btn" title={archived ? "Show it again" : "Hide it without losing history"}>
          {archived ? "Restore" : "Archive"}
        </button>
      </form>
      <button
        className="row-btn row-btn-danger"
        onClick={() => setConfirming(true)}
        title={`Delete ${name} for good`}
      >
        Delete
      </button>
      {confirming && (
        <DeleteDialog
          table={table}
          id={id}
          name={name}
          archived={archived}
          onBar={onBar}
          usedBy={usedBy}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

// ---- timer bar -----------------------------------------------------------

/** One of the two timers: an opt-in checkbox that unlocks its minutes field. */
function TimerToggle({
  icon,
  title,
  hint,
  name,
  on,
  setOn,
  value,
  setValue,
  forName,
  children,
}: {
  icon: string;
  title: string;
  hint: string;
  name: string;
  on: boolean;
  setOn: (v: boolean) => void;
  value: string;
  setValue: (v: string) => void;
  forName: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex w-fit cursor-pointer items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} aria-label={`${title} for ${forName}`} />
        <span aria-hidden>{icon}</span>
        {title}
      </label>
      <div className={`flex flex-wrap items-center gap-1.5 ${on ? "" : "opacity-40"}`}>
        {/* A disabled field is left out of the form, which the server reads as
            "off" — so while it is on the box must not be left empty. */}
        <input
          name={name}
          type="number"
          min={1}
          max={600}
          value={value}
          disabled={!on}
          required={on}
          onChange={(e) => setValue(e.target.value)}
          className="input w-20 px-2 py-1.5 text-sm"
          aria-label={`${title} minutes for ${forName}`}
        />
        <span className="text-xs text-muted">min</span>
        {children}
      </div>
      <span className="text-[11px] text-muted">{hint}</span>
    </div>
  );
}

/**
 * One activity on the timer bar: its order, its two timers and what follows it.
 * The notify timer only nudges; the end timer actually stops the activity.
 */
export function TimerBarRow({
  type,
  options,
  first,
  last,
}: {
  type: ActionType;
  /** Everything this activity is allowed to hand over to. */
  options: ActionType[];
  first: boolean;
  last: boolean;
}) {
  const [state, action, pending] = useActionState(saveTimerSettings, undefined);
  const [notify, setNotify] = useState(type.limit_min != null);
  const [notifyMin, setNotifyMin] = useState(String(type.limit_min ?? 30));
  const [autoEnd, setAutoEnd] = useState(type.end_min != null);
  const [endMin, setEndMin] = useState(String(type.end_min ?? 20));
  const [next, setNext] = useState(type.next_type_id ?? "");

  const nextName = options.find((o) => o.id === next)?.name ?? null;
  // The alert can only fire while the activity is still running.
  const alertNeverFires =
    notify && autoEnd && notifyMin !== "" && endMin !== "" && Number(endMin) <= Number(notifyMin);

  const summary = !notify && !autoEnd
    ? "No timers — it runs until you switch to something else."
    : notify && !autoEnd
      ? "Alerts you, then keeps running until you switch."
      : !notify && autoEnd
        ? nextName
          ? `Ends itself, then starts ${nextName}.`
          : "Ends itself, with nothing running afterwards."
        : nextName
          ? `Alerts you, keeps running, then ends itself and starts ${nextName}.`
          : "Alerts you, keeps running, then ends itself.";

  return (
    <div className="flex flex-col gap-2.5 py-3">
      <div className="flex items-center gap-2">
        <div className="flex shrink-0 flex-col">
          {(["up", "down"] as const).map((dir) => (
            <form action={moveTimerTask} key={dir}>
              <input type="hidden" name="id" value={type.id} />
              <input type="hidden" name="dir" value={dir} />
              <button
                className="px-1 text-[10px] leading-tight text-muted hover:text-ink disabled:opacity-25"
                disabled={dir === "up" ? first : last}
                aria-label={dir === "up" ? "Move up" : "Move down"}
              >
                {dir === "up" ? "▲" : "▼"}
              </button>
            </form>
          ))}
        </div>

        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg"
          style={{ background: `${type.color}22` }}
        >
          {type.emoji ?? "•"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{type.name}</span>

        <form action={removeFromTimerBar}>
          <input type="hidden" name="id" value={type.id} />
          <button className="row-btn row-btn-danger" title="Keeps the action and its history, just off the bar">
            Remove from bar
          </button>
        </form>
      </div>

      <form action={action} className="flex flex-wrap items-start gap-x-5 gap-y-3 sm:pl-8">
        <input type="hidden" name="id" value={type.id} />

        <TimerToggle
          icon="🔔"
          title="Notify after"
          hint="a nudge — the timer keeps running"
          name="limit_min"
          on={notify}
          setOn={setNotify}
          value={notifyMin}
          setValue={setNotifyMin}
          forName={type.name}
        />

        <TimerToggle
          icon="⏹"
          title="End after"
          hint="stops the activity by itself"
          name="end_min"
          on={autoEnd}
          setOn={setAutoEnd}
          value={endMin}
          setValue={setEndMin}
          forName={type.name}
        >
          <span className="text-xs text-muted">→ then start</span>
          <select
            name="next_type_id"
            value={next}
            disabled={!autoEnd}
            onChange={(e) => setNext(e.target.value)}
            className="input w-44 px-2 py-1.5 text-sm"
            aria-label={`Activity to start after ${type.name}`}
          >
            <option value="">nothing</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.emoji ? `${o.emoji} ` : ""}
                {o.name}
              </option>
            ))}
          </select>
        </TimerToggle>

        <div className="flex items-center gap-2 sm:ml-auto sm:self-center">
          <button className="btn-ghost text-xs" disabled={pending}>
            Save
          </button>
          <Status state={state} pending={pending} />
        </div>

        <p className="w-full text-[11px] text-muted">{summary}</p>
        {alertNeverFires && (
          <p className="w-full text-[11px] text-red-600">
            It ends at {endMin} min, before the alert at {notifyMin} min — so the alert never fires.
          </p>
        )}
      </form>
    </div>
  );
}

export function AddToTimerBar({ options }: { options: ActionType[] }) {
  const [id, setId] = useState("");
  if (options.length === 0) {
    return <p className="py-2 text-xs text-muted">Every action is already on the bar.</p>;
  }
  return (
    <form action={addToTimerBar} className="flex flex-wrap items-center gap-2 py-2">
      <select
        name="id"
        value={id}
        onChange={(e) => setId(e.target.value)}
        className="input w-56 py-2 text-sm"
        aria-label="Action to add to the timer bar"
      >
        <option value="">Add an existing action…</option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.emoji ? `${t.emoji} ` : ""}
            {t.name}
          </option>
        ))}
      </select>
      <button className="btn-primary px-3 py-2 text-sm" disabled={!id}>
        Add to bar
      </button>
    </form>
  );
}

// ---- actions & pain types ------------------------------------------------

export function ActionTypeRow({ type, usedBy = [] }: { type?: ActionType; usedBy?: string[] }) {
  const [state, action, pending] = useActionState(saveActionType, undefined);
  const [color, setColor] = useState(type?.color ?? "#3f8f6b");
  const isNew = !type;

  return (
    <div className={`flex flex-wrap items-center gap-2 py-2 ${type?.archived ? "opacity-50" : ""}`}>
      <form action={action} className="flex flex-1 flex-wrap items-center gap-2" key={isNew ? state?.ok : undefined}>
        {type && <input type="hidden" name="id" value={type.id} />}
        <input
          type="color"
          name="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
          aria-label="Color"
        />
        <input
          name="emoji"
          defaultValue={type?.emoji ?? ""}
          placeholder="🙂"
          maxLength={8}
          className="input w-14 px-2 text-center"
          aria-label="Emoji"
        />
        <input
          name="name"
          defaultValue={type?.name ?? ""}
          placeholder={isNew ? "New action, e.g. McGill big 3" : ""}
          required
          maxLength={60}
          className="input min-w-40 flex-1"
          aria-label="Name"
        />
        {type?.timer && <span className="text-[11px] text-muted">on timer bar</span>}
        <button className={isNew ? "btn-primary px-3 py-2 text-sm" : "btn-ghost"} disabled={pending}>
          {isNew ? "Add" : "Save"}
        </button>
        <Status state={state} pending={pending} />
      </form>
      {type && (
        <RowButtons
          table="action_types"
          id={type.id}
          name={type.name}
          archived={type.archived}
          onBar={type.timer}
          usedBy={usedBy}
        />
      )}
    </div>
  );
}

export function PainTypeRow({ type }: { type?: PainType }) {
  const [state, action, pending] = useActionState(savePainType, undefined);
  const [color, setColor] = useState(type?.color ?? "#d8662f");
  const isNew = !type;

  return (
    <div className={`flex flex-wrap items-center gap-2 py-2 ${type?.archived ? "opacity-50" : ""}`}>
      <form action={action} className="flex flex-1 flex-wrap items-center gap-2" key={isNew ? state?.ok : undefined}>
        {type && <input type="hidden" name="id" value={type.id} />}
        <input
          type="color"
          name="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
          aria-label="Color"
        />
        <input
          name="name"
          defaultValue={type?.name ?? ""}
          placeholder={isNew ? "New pain, e.g. Sharp twinge lower back" : ""}
          required
          maxLength={60}
          className="input min-w-40 flex-1"
          aria-label="Name"
        />
        <button className={isNew ? "btn-primary px-3 py-2 text-sm" : "btn-ghost"} disabled={pending}>
          {isNew ? "Add" : "Save"}
        </button>
        <Status state={state} pending={pending} />
      </form>
      {type && <RowButtons table="pain_types" id={type.id} name={type.name} archived={type.archived} />}
    </div>
  );
}

// ---- exercises -----------------------------------------------------------

/** One exercise in the library: what it is and the sets you usually do. */
export function ExerciseRow({ exercise }: { exercise?: Exercise }) {
  const [state, action, pending] = useActionState(saveExercise, undefined);
  const [color, setColor] = useState(exercise?.color ?? "#2f5d50");
  const [confirming, setConfirming] = useState(false);
  const isNew = !exercise;
  const n = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

  return (
    <div className={`flex flex-wrap items-center gap-2 py-2 ${exercise?.archived ? "opacity-50" : ""}`}>
      <form action={action} className="flex flex-1 flex-wrap items-center gap-2" key={isNew ? state?.ok : undefined}>
        {exercise && <input type="hidden" name="id" value={exercise.id} />}
        <input
          type="color"
          name="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent"
          aria-label="Color"
        />
        <input
          name="emoji"
          defaultValue={exercise?.emoji ?? ""}
          placeholder="🏋️"
          maxLength={8}
          className="input w-14 px-2 text-center"
          aria-label="Emoji"
        />
        <input
          name="name"
          defaultValue={exercise?.name ?? ""}
          placeholder={isNew ? "New exercise, e.g. Bird dog" : ""}
          required
          maxLength={60}
          className="input min-w-36 flex-1"
          aria-label="Exercise name"
        />
        <input name="sets" type="number" min={1} max={99} defaultValue={n(exercise?.sets)} placeholder="sets" className="input w-16 px-2" aria-label="Sets" />
        <input name="reps" type="number" min={1} max={999} defaultValue={n(exercise?.reps)} placeholder="reps" className="input w-16 px-2" aria-label="Reps" />
        <input name="weight_kg" type="number" min={0} step="0.5" defaultValue={n(exercise?.weight_kg)} placeholder="kg" className="input w-16 px-2" aria-label="Weight in kg" />
        <input name="rest_sec" type="number" min={0} max={3600} defaultValue={n(exercise?.rest_sec)} placeholder="rest s" className="input w-20 px-2" aria-label="Rest in seconds" />
        <input name="duration_min" type="number" min={1} max={600} defaultValue={n(exercise?.duration_min)} placeholder="min" className="input w-16 px-2" aria-label="Usual minutes" />
        <input
          name="notes"
          defaultValue={exercise?.notes ?? ""}
          placeholder="cues"
          maxLength={500}
          className="input min-w-32 flex-1"
          aria-label="Notes"
        />
        <button className={isNew ? "btn-primary px-3 py-2 text-sm" : "btn-ghost"} disabled={pending}>
          {isNew ? "Add" : "Save"}
        </button>
        <Status state={state} pending={pending} />
      </form>
      {exercise && (
        <div className="flex shrink-0 items-center gap-2">
          <form action={setExerciseArchived}>
            <input type="hidden" name="id" value={exercise.id} />
            <input type="hidden" name="archived" value={String(!exercise.archived)} />
            <button className="text-xs text-muted hover:text-ink">{exercise.archived ? "Restore" : "Archive"}</button>
          </form>
          {confirming ? (
            <form action={deleteExercise} className="flex items-center gap-1">
              <input type="hidden" name="id" value={exercise.id} />
              <button className="text-xs font-semibold text-red-600">Delete {exercise.name}?</button>
              <button type="button" className="text-xs text-muted" onClick={() => setConfirming(false)}>
                no
              </button>
            </form>
          ) : (
            <button className="text-xs text-muted hover:text-red-600" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
