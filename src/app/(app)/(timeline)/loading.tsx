// Shown instantly while a page's data loads.
export default function Loading() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-[1600px] animate-pulse flex-col gap-3 px-3 pt-1 pb-3 sm:px-5">
      <div className="h-[24%] min-h-40 rounded-3xl bg-surface-2" />
      <div className="flex-1 rounded-3xl bg-surface-2/60" />
      <div className="h-20 rounded-3xl bg-surface-2/60" />
    </div>
  );
}
