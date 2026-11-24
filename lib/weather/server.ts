import { MONTHS, calendarDate } from "../seasonalTime";
import { WEATHER_DATASET, CLIMATE, ClimateAccumulator, monthRanges, validateArchive, type ClimateMonth } from "./climate";

const DAY = 86400;
const memory = new Map<string, { expires: number; value: ClimateMonth }>();
const pending = new Map<string, Promise<ClimateMonth>>();
let nextRequestAt = 0;

export class WeatherError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

function dateAt(year: number, day: number, offset: number) {
  const { month, dayOfMonth } = calendarDate(day);
  const monthIndex = MONTHS.indexOf(month);
  return new Date(Date.UTC(year, monthIndex, dayOfMonth + offset)).toISOString().slice(0, 10);
}

async function archive(latitude: number, longitude: number, start: string, end: string, signal: AbortSignal) {
  // Bound weighted provider usage even when several clients request locations at once.
  const wait = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Date.now() + wait + 400;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  signal.throwIfAborted();
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.search = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), start_date: start, end_date: end,
    hourly: "temperature_2m,wind_speed_10m,precipitation", models: CLIMATE.model,
    timezone: "UTC", timeformat: "unixtime", temperature_unit: "celsius",
    wind_speed_unit: "kmh", precipitation_unit: "mm", cell_selection: "nearest", elevation: "nan",
  }).toString();
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]), next: { revalidate: 30 * DAY },
  });
  if (response.status === 429) throw new WeatherError("The weather provider is busy. Please try again in a minute.", 429);
  if (!response.ok) throw new WeatherError("Historical weather is temporarily unavailable. Please try again.");
  return validateArchive(await response.json());
}

async function buildMonth(latitude: number, longitude: number, month: number): Promise<ClimateMonth> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  const accumulator = new ClimateAccumulator();
  const jobs: { start: string; end: string }[] = [];
  for (let year = CLIMATE.startYear; year <= CLIMATE.endYear; year++) {
    for (const range of monthRanges(month, CLIMATE.radius)) {
      // The buffer covers local-day boundaries and historical DST offsets.
      jobs.push({ start: dateAt(year, range.start, -1), end: dateAt(year, range.end, 1) });
    }
  }
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      controller.signal.throwIfAborted();
      accumulator.add(await archive(latitude, longitude, job.start, job.end, controller.signal));
    }
  };
  try {
    await Promise.all([worker(), worker()]);
    const result = accumulator.finish(month, { latitude, longitude });
    if (!Object.values(result.counts).some((values) => values.some((value) => value > 0))) {
      throw new WeatherError("No historical weather is available for this location.", 404);
    }
    return result;
  } catch (error) {
    controller.abort();
    if (error instanceof WeatherError) throw error;
    console.error("Historical weather lookup failed:", error instanceof Error ? error.message : "Unknown provider error");
    throw new WeatherError("Historical weather could not be loaded. Please try again.");
  } finally { clearTimeout(timeout); }
}

/** Bounded process cache plus persistent per-range Next.js fetch caching. */
export async function getClimateMonth(latitude: number, longitude: number, month: number) {
  const key = `${WEATHER_DATASET},${latitude},${longitude},${month}`;
  const cached = memory.get(key);
  if (cached && cached.expires > Date.now()) {
    memory.delete(key); memory.set(key, cached);
    return cached.value;
  }
  memory.delete(key);
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 2) throw new WeatherError("Other locations are being prepared. Please try again shortly.", 503);
  const job = buildMonth(latitude, longitude, month).then((value) => {
    memory.set(key, { value, expires: Date.now() + 7 * DAY * 1000 });
    while (memory.size > 48) memory.delete(memory.keys().next().value!);
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}
