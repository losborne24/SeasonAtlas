import { MONTHS } from "../seasonalTime";

export const ANNUAL_DATASET = "annual-temperature-2020-2024-05deg-v1";
export interface AnnualTemperature {
  version: 1;
  baseline: [number, number];
  hourUTC: number;
  resolutionDegrees: number;
  monthly: (number | null)[];
}

/** Month centres in the same non-leap calendar as the timeline. */
export const MONTH_CENTRES = MONTHS.map((month, index) =>
  (month.start + (MONTHS[index + 1]?.start ?? 366) - 1) / 2);

/** Cyclic interpolation for placing the selected-day marker on the monthly curve. */
export function annualValue(monthly: (number | null)[], day: number): number | null {
  let right = MONTH_CENTRES.findIndex((centre) => centre >= day);
  if (right >= 0 && MONTH_CENTRES[right] === day) return monthly[right];
  if (right === -1) right = 12;
  const left = right - 1;
  const a = monthly[(left + 12) % 12], b = monthly[right % 12];
  if (a == null || b == null) return null;
  const x0 = left < 0 ? MONTH_CENTRES[11] - 365 : MONTH_CENTRES[left];
  const x1 = right === 12 ? MONTH_CENTRES[0] + 365 : MONTH_CENTRES[right];
  return a + (b - a) * (day - x0) / (x1 - x0);
}
