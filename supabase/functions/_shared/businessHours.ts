/**
 * businessHours.ts — shared helper for the refund-eligibility window (mp-refund, C5).
 *
 * Rule (confirmed by Mateo, 2026-07-23): a cancellation is refund-eligible only if
 * at least `platform_settings.refund_window_business_hours` (default 48) business
 * hours separate `now()` from `consultations.scheduled_at`.
 *
 * "Business hours" here means: count every hour that falls on a Monday–Friday
 * calendar day (in America/Argentina/Buenos_Aires, UTC-3, no DST) — weekend hours
 * don't count, weekday hours all count (no 9-to-5 restriction). Holidays are
 * intentionally NOT excluded yet (SECCIÓN E — out of scope for this phase).
 */

// Argentina has no DST — fixed UTC-3 offset year-round.
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Shifts a real UTC epoch ms value so that treating the result's UTC fields
 * (getUTCDay/getUTCHours/etc.) as if they were UTC actually yields the
 * America/Argentina/Buenos_Aires wall-clock day/hour. Standard trick for
 * fixed-offset zones — do not use for zones with DST.
 */
function toArShiftedMs(utcMs: number): number {
  return utcMs - AR_OFFSET_MS;
}

/**
 * Counts business hours (Mon–Fri, no holiday calendar) between two real UTC
 * epoch millisecond instants, evaluated in Argentina local time. Returns 0 if
 * `toMs <= fromMs` (i.e. the target instant is not in the future).
 */
export function businessHoursBetween(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;

  const start = toArShiftedMs(fromMs);
  const end = toArShiftedMs(toMs);

  let totalMs = 0;
  let cursor = start;

  // Walk day by day (bounded by the number of calendar days in the window —
  // cheap even for windows of weeks/months) so weekend days are excluded
  // wholesale and weekday days count in full (or partially, for the first/last
  // partial day of the window).
  while (cursor < end) {
    const cursorDate = new Date(cursor);
    const nextLocalMidnight = Date.UTC(
      cursorDate.getUTCFullYear(),
      cursorDate.getUTCMonth(),
      cursorDate.getUTCDate() + 1,
      0, 0, 0, 0
    );
    const segmentEnd = Math.min(end, nextLocalMidnight);
    const weekday = cursorDate.getUTCDay(); // 0=Sun..6=Sat, already in AR local terms
    if (weekday >= 1 && weekday <= 5) {
      totalMs += segmentEnd - cursor;
    }
    cursor = segmentEnd;
  }

  return totalMs / (60 * 60 * 1000);
}

/**
 * Convenience wrapper: is `scheduledAt` at least `windowBusinessHours` business
 * hours away from `now`?
 */
export function isRefundEligible(
  scheduledAt: string | Date,
  windowBusinessHours: number,
  now: Date = new Date()
): boolean {
  const scheduledMs =
    typeof scheduledAt === "string" ? new Date(scheduledAt).getTime() : scheduledAt.getTime();
  const hours = businessHoursBetween(now.getTime(), scheduledMs);
  return hours >= windowBusinessHours;
}
