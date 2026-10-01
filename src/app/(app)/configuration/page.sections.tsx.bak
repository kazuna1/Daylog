import { createClient } from "@/lib/supabase/server";
import { getTz } from "@/lib/tz";
import { seedDefaults } from "./actions";
import { ActionTypeRow, AddToTimerBar, ExerciseRow, PainTypeRow, TimerBarRow } from "./forms";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card mb-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-0.5 mb-2 text-xs text-muted">{hint}</p>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const tz = await getTz();
  const supabase = await createClient();
  const [actionTypes, painTypes, exercises] = await Promise.all([
    supabase.from("action_types").select("*").order("archived").order("sort").order("name"),
    supabase.from("pain_types").select("*").order("archived").order("sort").order("name"),
    supabase.from("exercises").select("*").order("archived").order("sort").order("name"),
  ]);

  const actions = actionTypes.data ?? [];
  const bar = actions.filter((t) => t.timer && !t.archived);
  const offBar = actions.filter((t) => !t.timer && !t.archived);
  const live = actions.filter((t) => !t.archived);
  const empty = actions.length === 0 && (painTypes.data ?? []).length === 0;

  /** Names of the activities whose end timer hands over to `id`. */
  const followersOf = (id: string) => actions.filter((t) => t.next_type_id === id).map((t) => t.name);

  return (
    <div className="mx-auto w-full max-w-4xl px-3 py-5 sm:px-5">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mb-5 text-sm text-muted">Everything you can configure: the timer bar, your actions and your pain types.</p>

      {empty && (
        <form action={seedDefaults} className="card mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">Start with a ready-made set (sleep, stretching, sitting… and common back pains)?</p>
          <button className="btn-primary px-3 py-2 text-sm">Add starter set</button>
        </form>
      )}

      <Section
        title="Timer bar"
        hint="The one-tap activities on Today, in this order. Tapping one starts it and ends the previous. Each has two separate timers: notify after only sends an alert and keeps counting, while end after stops the activity on its own and can start the next one for you."
      >
        {bar.map((t, i) => (
          <TimerBarRow
            key={t.id}
            type={t}
            options={live.filter((o) => o.id !== t.id)}
            first={i === 0}
            last={i === bar.length - 1}
          />
        ))}
        {bar.length === 0 && <p className="py-2 text-xs text-muted">No activities on the bar yet.</p>}
        <AddToTimerBar options={offBar} />
      </Section>

      <Section
        title="Actions"
        hint="Everything you can log, on the bar or not. Archive instead of deleting to keep history."
      >
        {actions.map((t) => (
          <ActionTypeRow key={t.id} type={t} usedBy={followersOf(t.id)} />
        ))}
        <ActionTypeRow />
      </Section>

      <Section
        title="Exercises"
        hint="Your exercise library with its usual sets, reps, weight and rest. Right-click the timeline to log one — the numbers come prefilled and you adjust what you actually did."
      >
        {(exercises.data ?? []).map((e) => (
          <ExerciseRow key={e.id} exercise={e} />
        ))}
        <ExerciseRow />
      </Section>

      <Section title="Pain types" hint="Your own pain vocabulary, used for pain events on the timeline.">
        {(painTypes.data ?? []).map((t) => (
          <PainTypeRow key={t.id} type={t} />
        ))}
        <PainTypeRow />
      </Section>

      <Section title="This device" hint="Detected automatically; nothing to change here.">
        <dl className="grid grid-cols-2 gap-y-1 py-2 text-sm">
          <dt className="text-muted">Timezone</dt>
          <dd>{tz}</dd>
          <dt className="text-muted">Timeline window</dt>
          <dd>Set with the clock button above the timeline</dd>
          <dt className="text-muted">Alerts</dt>
          <dd>Enable them once per device from the timer bar</dd>
        </dl>
      </Section>
    </div>
  );
}
