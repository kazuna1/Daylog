"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Today", match: (p: string) => p === "/" },
  { href: "/days", label: "All days", match: (p: string) => p.startsWith("/days") || p.startsWith("/day/") },
  { href: "/configuration", label: "Configuration", match: (p: string) => p.startsWith("/configuration") },
];

export function HeaderNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 rounded-full bg-surface-2 p-1">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
