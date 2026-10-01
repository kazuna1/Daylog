/** Neutral placeholder for the list-shaped pages (Notes, Configuration). */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl animate-pulse px-3 py-5 sm:px-5">
      <div className="mb-5 h-8 w-40 rounded-lg bg-surface-2" />
      <div className="mb-3 h-28 rounded-2xl bg-surface-2/70" />
      <div className="mb-3 h-20 rounded-2xl bg-surface-2/50" />
      <div className="h-20 rounded-2xl bg-surface-2/40" />
    </div>
  );
}
