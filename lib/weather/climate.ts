import { MONTHS, wrapDay } from "../seasonalTime";

export const CLIMATE = { startYear: 2020, endYear: 2024, radius: 7, model: "era5" } as const;
export const WEATHER_DATASET = `${CLIMATE.model}-${CLIMATE.startYear}-${CLIMATE.endYear}-r${CLIMATE.radius}-utc-v2`;
export const VARIABLES = ["temperature_2m", "wind_speed_10m", "precipitation"] as const;
export type Variable = (typeof VARIABLES)[number];
export type Values = Record<Variable, (number | null)[]>;
export type Counts = Record<Variable, number[]>;
export const HOURS_PER_YEAR = 365 * 24;

export interface ArchiveChunk {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly_units: Record<Variable, string> & { time: string };
  hourly: Record<Variable, (number | null)[]> & { time: number[] };
}

export interface ClimateMonth {
  version: 1;
  requested: { latitude: number; longitude: number };
  grid: { latitude: number; longitude: number; resolution: string };
  timezone: string;
  baseline: { startYear: number; endYear: number };
  radius: number;
  month: number;
  startDay: number;
  days: number;
  expectedSamples: number;
  values: Values;
  counts: Counts;
}

export function monthBounds(month: number) {
  const start = MONTHS[month - 1].start;
  const end = month === 12 ? 365 : MONTHS[month].start - 1;
  return { start, end };
}

/** Split wrapped windows into contiguous calendar ranges, without extending the baseline. */
export function monthRanges(month: number, radius: number) {
  const { start, end } = monthBounds(month);
  const days = new Set<number>();
  for (let day = start - radius; day <= end + radius; day++) days.add(wrapDay(day));
  const sorted = [...days].sort((a, b) => a - b);
  const ranges: { start: number; end: number }[] = [];
  for (const day of sorted) {
    const last = ranges.at(-1);
    if (last && last.end + 1 === day) last.end = day;
    else ranges.push({ start: day, end: day });
  }
  return ranges;
}

/** Parse and validate provider output before it reaches the aggregation pipeline. */
export function validateArchive(data: unknown): ArchiveChunk {
  if (!data || typeof data !== "object") throw new Error("Malformed weather response.");
  const chunk = data as ArchiveChunk;
  if (!Number.isFinite(chunk.latitude) || !Number.isFinite(chunk.longitude) ||
    typeof chunk.timezone !== "string" || !Array.isArray(chunk.hourly?.time) ||
    chunk.hourly_units?.time !== "unixtime") throw new Error("Malformed weather response.");
  new Intl.DateTimeFormat("en", { timeZone: chunk.timezone });
  const units = ["°C", "km/h", "mm"];
  for (let i = 0; i < VARIABLES.length; i++) {
    const variable = VARIABLES[i];
    if (chunk.hourly_units[variable] !== units[i] || !Array.isArray(chunk.hourly[variable]) ||
      chunk.hourly[variable].length !== chunk.hourly.time.length) throw new Error("Unexpected weather units or array length.");
  }
  if (chunk.hourly.time.length === 0) throw new Error("Empty weather response.");
  for (let i = 0; i < chunk.hourly.time.length; i++) {
    if (!Number.isFinite(chunk.hourly.time[i]) || (i > 0 && chunk.hourly.time[i] <= chunk.hourly.time[i - 1])) {
      throw new Error("Invalid weather timestamps.");
    }
    for (const variable of VARIABLES) {
      const value = chunk.hourly[variable][i];
      if (value !== null && (!Number.isFinite(value) || (variable !== "temperature_2m" && value < 0))) {
        throw new Error("Invalid weather values.");
      }
    }
  }
  return chunk;
}

type Bin = { sums: number[]; counts: number[] };

/** Equal weight per local calendar day and year; repeated DST hours are averaged first. */
export class ClimateAccumulator {
  private bins = new Map<number, Bin>();
  private timestamps = new Set<number>();
  private metadata: Pick<ArchiveChunk, "latitude" | "longitude" | "timezone"> | null = null;
  private formatter: Intl.DateTimeFormat | null = null;

  constructor(private readonly baseline = { startYear: CLIMATE.startYear as number, endYear: CLIMATE.endYear as number }) {}

  add(chunk: ArchiveChunk) {
    if (this.metadata && (chunk.timezone !== this.metadata.timezone ||
      Math.abs(chunk.latitude - this.metadata.latitude) > 0.00001 ||
      Math.abs(chunk.longitude - this.metadata.longitude) > 0.00001)) throw new Error("Weather grid changed within the baseline.");
    this.metadata = chunk;
    this.formatter ??= new Intl.DateTimeFormat("en-GB", {
      timeZone: chunk.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
    });
    for (let i = 0; i < chunk.hourly.time.length; i++) {
      const stamp = chunk.hourly.time[i];
      if (this.timestamps.has(stamp)) continue;
      this.timestamps.add(stamp);
      const parts = this.formatter.formatToParts(stamp * 1000);
      const field = (type: string) => Number(parts.find((part) => part.type === type)?.value);
      const year = field("year"), month = field("month"), day = field("day"), hour = field("hour");
      if (year < this.baseline.startYear || year > this.baseline.endYear || (month === 2 && day === 29)) continue;
      const calendarDay = MONTHS[month - 1].start + day - 1;
      const index = (year - this.baseline.startYear) * HOURS_PER_YEAR + (calendarDay - 1) * 24 + hour;
      let bin = this.bins.get(index);
      if (!bin) { bin = { sums: [0, 0, 0], counts: [0, 0, 0] }; this.bins.set(index, bin); }
      for (let v = 0; v < VARIABLES.length; v++) {
        const value = chunk.hourly[VARIABLES[v]][i];
        if (value !== null) { bin.sums[v] += value; bin.counts[v]++; }
      }
    }
  }

  finish(month: number, requested: ClimateMonth["requested"], radius: number = CLIMATE.radius): ClimateMonth {
    if (!this.metadata) throw new Error("No historical weather data.");
    const { start, end } = monthBounds(month);
    const values: Values = { temperature_2m: [], wind_speed_10m: [], precipitation: [] };
    const counts: Counts = { temperature_2m: [], wind_speed_10m: [], precipitation: [] };
    for (let day = start; day <= end; day++) for (let hour = 0; hour < 24; hour++) {
      const sums = [0, 0, 0], totals = [0, 0, 0];
      for (let year = this.baseline.startYear; year <= this.baseline.endYear; year++) {
        for (let offset = -radius; offset <= radius; offset++) {
          const index = (year - this.baseline.startYear) * HOURS_PER_YEAR + (wrapDay(day + offset) - 1) * 24 + hour;
          const bin = this.bins.get(index);
          if (!bin) continue;
          for (let v = 0; v < VARIABLES.length; v++) if (bin.counts[v]) {
            sums[v] += bin.sums[v] / bin.counts[v]; totals[v]++;
          }
        }
      }
      for (let v = 0; v < VARIABLES.length; v++) {
        const variable = VARIABLES[v];
        values[variable].push(totals[v] ? Number((sums[v] / totals[v]).toFixed(3)) : null);
        counts[variable].push(totals[v]);
      }
    }
    return {
      version: 1, requested, grid: { latitude: this.metadata.latitude, longitude: this.metadata.longitude, resolution: "0.25° (about 25 km)" },
      timezone: this.metadata.timezone, baseline: this.baseline, radius, month, startDay: start, days: end - start + 1,
      expectedSamples: (this.baseline.endYear - this.baseline.startYear + 1) * (radius * 2 + 1), values, counts,
    };
  }
}
