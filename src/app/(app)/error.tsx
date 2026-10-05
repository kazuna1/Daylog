"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Retries a failed render by itself, so a hiccup on the server is invisible
 * instead of an error you have to reload past.
 *
 * `reset()` alone only re-renders what is already in the browser; the page is
 * rendered on the server, so it needs `router.refresh()` to be fetched again.
 */
export default function DayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const tries = useRef(0);

  useEffect(() => {
    if (tries.current >= 2) return;
    tries.current += 1;
    const id = setTimeout(
      () => {
        router.refresh();
        reset();
      },
      tries.current * 400,
    );
    return () => clearTimeout(id);
  }, [reset, router]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 px-5 py-16 text-center">
      <p className="text-sm text-muted">Reloading…</p>
      <button
        onClick={() => {
          router.refresh();
          reset();
        }}
        className="btn-primary px-4 py-2 text-sm"
      >
        Try again
      </button>
      {error.digest && <p className="text-[11px] text-muted">ref {error.digest}</p>}
    </div>
  );
}
