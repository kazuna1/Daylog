import { notFound, redirect } from "next/navigation";
import { DayView } from "@/components/day/day-view";
import { loadTimeline } from "@/lib/day-data";
import { isDay, localDay } from "@/lib/time";
import { getTz, getViewHours, requestNow } from "@/lib/tz";

/** Deep link to a past day: the same endless strip, opened on that day. */
export default async function DayPage({ params }: PageProps<"/day/[date]">) {
  const { date } = await params;
  if (!isDay(date)) notFound();

  const [tz, viewHours] = await Promise.all([getTz(), getViewHours()]);
  const now = await requestNow();
  const today = localDay(tz, new Date(now));
  if (date === today) redirect("/");
  if (date > today) notFound();

  const data = await loadTimeline(tz, date);
  return <DayView key={date} data={data} tz={tz} focusDay={date} serverNow={now} viewHours={viewHours} />;
}
