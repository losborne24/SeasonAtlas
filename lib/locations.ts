import type { SelectedLocation } from "@/state/explorationStore";

export const SUGGESTED_CITIES: SelectedLocation[] = [
  { name: "Paris", country: "France", latitude: 48.85341, longitude: 2.3488, source: "search" },
  { name: "London", country: "United Kingdom", latitude: 51.50853, longitude: -0.12574, source: "search" },
  { name: "Berlin", country: "Germany", latitude: 52.52437, longitude: 13.41053, source: "search" },
  { name: "Rome", country: "Italy", latitude: 41.89193, longitude: 12.51133, source: "search" },
];

export function formatCoordinates(latitude: number, longitude: number) {
  return `${Math.abs(latitude).toFixed(4)}° ${latitude < 0 ? "S" : "N"}, ${Math.abs(longitude).toFixed(4)}° ${longitude < 0 ? "W" : "E"}`;
}

/** Coordinate input uses latitude, longitude, matching the visible input hint. */
export function parseCoordinates(query: string): SelectedLocation | null {
  const match = query.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { name: "Selected coordinates", latitude, longitude, source: "coordinates" };
}

interface GeocodingResult {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  admin1?: string;
  elevation?: number;
  timezone?: string;
}

export async function searchCities(query: string, signal: AbortSignal): Promise<SelectedLocation[]> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.search = new URLSearchParams({ name: query, count: "6", language: "en", format: "json" }).toString();
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("City search is unavailable.");
  const data: { results?: GeocodingResult[]; error?: boolean } = await response.json();
  if (data.error) throw new Error("City search is unavailable.");
  return (data.results ?? []).filter((city) =>
    typeof city.name === "string" && Number.isFinite(city.latitude) &&
    Number.isFinite(city.longitude) && Math.abs(city.latitude) <= 90 &&
    Math.abs(city.longitude) <= 180,
  ).map((city) => ({
    name: city.name, latitude: city.latitude, longitude: city.longitude,
    country: city.country, region: city.admin1, elevation: city.elevation,
    timezone: city.timezone, source: "search",
  }));
}
