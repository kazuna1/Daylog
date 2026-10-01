"use client";

import { useActionState, useRef, useState } from "react";
import type { Note } from "@/lib/database.types";
import { createNote, deleteNote, togglePin, updateNote } from "./actions";

/** Textarea that grows with its content, so long notes don't hide in a scrollbox. */
function GrowingTextarea({
  name,
  defaultValue,
  placeholder,
  autoFocus,
  onSubmitShortcut,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmitShortcut?: (form: HTMLFormElement) => void;
}) {
  const grow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  return (
    <textarea
      name={name}
      defaultValue={defaultValue}
      placeholder={placeholder}
      autoFocus={autoFocus}
      rows={3}
      maxLength={10000}
      className="input min-h-20 resize-none leading-relaxed"
      ref={(el) => {
        if (el) grow(el);
      }}
      onInput={(e) => grow(e.currentTarget)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmitShortcut) {
          e.preventDefault();
          onSubmitShortcut(e.currentTarget.form!);
        }
      }}
    />
  );
}

export function NoteComposer() {
  const [state, action, pending] = useActionState(createNote, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form ref={formRef} action={action} key={state?.ok} className="card mb-5 flex flex-col gap-2">
      <GrowingTextarea
        name="body"
        placeholder="Write anything — what you noticed, what to try, a question for the doctor…"
        onSubmitShortcut={(f) => f.requestSubmit()}
      />
      <div className="flex items-center gap-3">
        <button className="btn-primary px-4 py-2 text-sm" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </button>
        <span className="text-xs text-muted">Ctrl + Enter saves</span>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

function NoteCard({ note, formatted }: { note: Note; formatted: string }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(updateNote, undefined);
  const [lastSaved, setLastSaved] = useState<number | undefined>(undefined);

  // Close the editor once the save comes back clean.
  if (state?.ok && state.ok !== lastSaved) {
    setLastSaved(state.ok);
    setEditing(false);
  }

  return (
    <article className={`card flex flex-col gap-2 ${note.pinned ? "border-accent/60" : ""}`}>
      {editing ? (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={note.id} />
          <GrowingTextarea name="body" defaultValue={note.body} autoFocus onSubmitShortcut={(f) => f.requestSubmit()} />
          <div className="flex items-center gap-2">
            <button className="btn-primary px-3 py-1.5 text-sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn-ghost text-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
          </div>
        </form>
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{note.body}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {note.pinned && <span className="font-medium text-accent">📌 Pinned</span>}
        <span>{formatted}</span>
        <div className="ml-auto flex items-center gap-2">
          {!editing && (
            <button className="hover:text-ink" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <form action={togglePin}>
            <input type="hidden" name="id" value={note.id} />
            <input type="hidden" name="pinned" value={String(!note.pinned)} />
            <button className="hover:text-ink">{note.pinned ? "Unpin" : "Pin"}</button>
          </form>
          {confirming ? (
            <form action={deleteNote} className="flex items-center gap-1.5">
              <input type="hidden" name="id" value={note.id} />
              <button className="font-semibold text-red-600">Delete?</button>
              <button type="button" onClick={() => setConfirming(false)}>
                no
              </button>
            </form>
          ) : (
            <button className="hover:text-red-600" onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** The whole list, with a filter box once there are enough notes to need one. */
export function NoteList({ notes }: { notes: (Note & { formatted: string })[] }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const shown = term ? notes.filter((n) => n.body.toLowerCase().includes(term)) : notes;

  return (
    <>
      {notes.length > 5 && (
        <input
          className="input mb-3"
          placeholder={`Search ${notes.length} notes…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search notes"
        />
      )}
      {shown.length === 0 && (
        <p className="py-10 text-center text-sm text-muted">
          {notes.length === 0 ? "No notes yet — write anything you want to remember." : "Nothing matches that."}
        </p>
      )}
      <div className="flex flex-col gap-3">
        {shown.map((n) => (
          <NoteCard key={n.id} note={n} formatted={n.formatted} />
        ))}
      </div>
    </>
  );
}
