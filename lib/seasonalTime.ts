/** A yearless, non-leap calendar for seasonal exploration; no weather baseline implied. */
export const DAYS_IN_YEAR = 365;
export const MONTHS = [
  { name: "January", short: "Jan", start: 1 },
  { name: "February", short: "Feb", start: 32 },
  { name: "March", short: "Mar", start: 60 },
  { name: "April", short: "Apr", start: 91 },
  { name: "May", short: "May", start: 121 },
  { name: "June", short: "Jun", start: 152 },
  { name: "July", short: "Jul", start: 182 },
  { name: "August", short: "Aug", start: 213 },
  { name: "September", short: "Sep", start: 244 },
  { name: "October", short: "Oct", start: 274 },
  { name: "November", short: "Nov", start: 305 },
  { name: "December", short: "Dec", start: 335 },
] as const;
export const PLAYBACK_SPEEDS = [1, 2, 4] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export function wrapDay(day: number) {
  return ((day - 1) % DAYS_IN_YEAR + DAYS_IN_YEAR) % DAYS_IN_YEAR + 1;
}

export function calendarDate(day: number) {
  const monthIndex = MONTHS.findLastIndex((month) => day >= month.start);
  const month = MONTHS[Math.max(0, monthIndex)];
  return { month, dayOfMonth: day - month.start + 1 };
}

export function formatSeasonalDate(day: number) {
  const { month, dayOfMonth } = calendarDate(day);
  return `${dayOfMonth} ${month.name}`;
}

export function formatHour(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Meteorological seasons for the initial Europe experience. */
export function seasonForDay(day: number) {
  if (day < 60 || day >= 335) return "Winter";
  if (day < 152) return "Spring";
  if (day < 244) return "Summer";
  return "Autumn";
}
