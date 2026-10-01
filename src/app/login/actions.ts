"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string } | undefined;

const FAIL_DELAY_MS = 1000; // slows down password guessing

function sameSecret(a: string, b: string) {
  // Hash first so lengths match and the comparison is constant-time.
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export async function signIn(_: LoginState, fd: FormData): Promise<LoginState> {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return { error: "APP_PASSWORD is not set on the server (.env.local / Vercel)." };

  const password = fd.get("password");
  if (typeof password !== "string" || !sameSecret(password, expected)) {
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return { error: "Wrong password." };
  }

  // The password is right: open a session for the internal account that owns the data.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.DAYLOG_DB_EMAIL!,
    password: process.env.DAYLOG_DB_PASSWORD!,
  });
  if (error) return { error: `Database login failed: ${error.message}` };

  // No starter set on login: an empty app stays empty until you add your own.
  // Settings still offers the starter set as a button if you ever want it.
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
