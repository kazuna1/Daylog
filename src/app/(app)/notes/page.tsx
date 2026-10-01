import { createClient } from "@/lib/supabase/server";
import { getTz } from "@/lib/tz";
import { NoteComposer, NoteList } from "./note-list";

/** "2 Oct, 14:05" in your timezone, with a hint when the note was edited later. */
function stamp(tz: string, note: { created_at: string; updated_at: string }) {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(note.created_at));
  const edited = new Date(note.updated_at).getTime() - new Date(note.created_at).getTime() > 60_000;
  return edited ? `${when} · edited` : when;
}

export default async function NotesPage() {
  const tz = await getTz();
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select("*")
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });

  const notes = (data ?? []).map((n) => ({ ...n, formatted: stamp(tz, n) }));

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-5 sm:px-5">
      <h1 className="text-2xl font-semibold tracking-tight">Notes</h1>
      <p className="mb-5 text-sm text-muted">
        Anything you want to keep, with no time attached — patterns you notice, things to try, questions for the doctor.
        Notes about a specific moment belong on the timeline instead.
      </p>

      <NoteComposer />
      <NoteList notes={notes} />
    </div>
  );
}
