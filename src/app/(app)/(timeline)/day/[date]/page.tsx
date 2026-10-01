import { notFound, redirect } from "next/navigation";
import { DayView } from "@/components/day/day-view";
import { loadDay } from "@/lib/day-data";
import { isDay, localDay } from "@/lib/time";
import { getTz, getViewHours, requestNow } from "@/lib/tz";

export default async function DayPage({ params }: PageProps<"/day/[date]">) {
  const { date } = await params;
  if (!isDay(date)) notFound();

  const [tz, viewHours] = await Promise.all([getTz(), getViewHours()]);
  const now = await requestNow();
  const today = localDay(tz, new Date(now));
  if (date === today) redirect("/");
  if (date > today) notFound();

  const data = await loadDay(tz, date);
  return <DayView key={date} data={data} tz={tz} isToday={false} serverNow={now} viewHours={viewHours} />;
}
