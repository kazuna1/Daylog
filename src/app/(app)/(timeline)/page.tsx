import { DayView } from "@/components/day/day-view";
import { loadTimeline } from "@/lib/day-data";
import { localDay } from "@/lib/time";
import { getTz, getViewHours, requestNow } from "@/lib/tz";

export default async function TodayPage() {
  const [tz, viewHours] = await Promise.all([getTz(), getViewHours()]);
  const now = await requestNow();
  const today = localDay(tz, new Date(now));
  const data = await loadTimeline(tz, today);
  return <DayView key={today} data={data} tz={tz} focusDay={today} serverNow={now} viewHours={viewHours} />;
}
