"use client";

import { useState, useSyncExternalStore } from "react";

const subscribeNothing = () => () => {};
const readPermission = (): NotificationPermission | "unsupported" =>
  "Notification" in window ? Notification.permission : "unsupported";

/**
 * Browser notifications can only be asked for from a click, so the button lives
 * here rather than being something the timer bar does on its own.
 */
export function AlertsButton() {
  const browser = useSyncExternalStore(subscribeNothing, readPermission, () => "default" as const);
  const [asked, setAsked] = useState<NotificationPermission | null>(null);
  const permission = asked ?? browser;

  if (permission === "unsupported") return <span className="text-muted">This browser has no notifications</span>;
  if (permission === "granted") return <span>On for this device</span>;
  if (permission === "denied") {
    return <span className="text-muted">Blocked — allow notifications for this site in your browser settings</span>;
  }

  return (
    <button
      onClick={() => Notification.requestPermission().then(setAsked)}
      className="btn-ghost -my-1 px-2 py-1 text-sm"
    >
      🔔 Enable alerts
    </button>
  );
}
