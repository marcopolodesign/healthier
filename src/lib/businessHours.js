/**
 * businessHours.js — client-side mirror of the server's refund-eligibility
 * check (spec: Healthier MP split payments, Sección C5/D3).
 *
 * Business hours = Monday–Friday, any hour of the day (holidays are not
 * considered yet — see spec Sección E). This is ONLY for instant UX feedback
 * (showing/hiding the "cancelar con reintegro" CTA); the server (mp-refund
 * Edge Function) always revalidates against platform_settings before
 * actually issuing a refund.
 */

const MS_PER_HOUR = 60 * 60 * 1000

/** Counts whole business hours (Mon–Fri) between two dates. */
export function countBusinessHours(from, to) {
  const start = new Date(from)
  const end = new Date(to)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0
  if (end <= start) return 0

  let hours = 0
  const cursor = new Date(start)
  cursor.setMinutes(0, 0, 0)
  while (cursor < end) {
    const day = cursor.getDay() // 0 = Sunday .. 6 = Saturday
    if (day >= 1 && day <= 5) hours++
    cursor.setTime(cursor.getTime() + MS_PER_HOUR)
  }
  return hours
}

/**
 * True when there are at least `windowHours` business hours between now and
 * `scheduledAt` — mirrors platform_settings.refund_window_business_hours
 * (default 48).
 */
export function isRefundEligible(scheduledAt, windowHours = 48) {
  if (!scheduledAt) return false
  const scheduled = new Date(scheduledAt)
  if (Number.isNaN(scheduled.getTime())) return false
  return countBusinessHours(new Date(), scheduled) >= windowHours
}
