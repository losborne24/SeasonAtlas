import type { Map } from "maplibre-gl";

export const TEMPERATURE_BASE = process.env.NEXT_PUBLIC_TEMPERATURE_TILE_URL ?? "http://127.0.0.1:8767/europe-temperature-v1";
export const TEMPERATURE_SOURCE = "seasonal-temperature";
export const TEMPERATURE_LAYER = "seasonal-temperature-colour";

export interface TemperatureAtlas {
  version: 1;
  kind: "era5" | "test";
  baseline: [number, number];
  windowDays: number;
  statistic: "daily_mean";
  timezone: "UTC";
  variable: "temperature_2m";
  bounds: [number, number, number, number];
  resolutionDegrees: number;
  minzoom: number;
  maxzoom: number;
  days: number[];
  tileSize: 256;
  format: "png";
  colors: { value: number; color: string }[];
}

export function validateTemperatureAtlas(value: unknown): TemperatureAtlas {
  const atlas = value as TemperatureAtlas;
  if (!atlas || atlas.version !== 1 || !["era5", "test"].includes(atlas.kind) ||
    (atlas.kind === "test" && process.env.NODE_ENV !== "development") ||
    atlas.baseline?.[0] !== 2015 || atlas.baseline?.[1] !== 2024 || atlas.windowDays !== 15 ||
    atlas.statistic !== "daily_mean" || atlas.timezone !== "UTC" || atlas.variable !== "temperature_2m" ||
    atlas.tileSize !== 256 || atlas.format !== "png" || atlas.minzoom !== 0 ||
    !Number.isInteger(atlas.maxzoom) || atlas.maxzoom < 0 || atlas.maxzoom > 5 ||
    !Number.isFinite(atlas.resolutionDegrees) || atlas.resolutionDegrees <= 0 ||
    (atlas.kind === "era5" && atlas.resolutionDegrees !== 0.25) ||
    !Array.isArray(atlas.bounds) || atlas.bounds.length !== 4 || !atlas.bounds.every(Number.isFinite) ||
    atlas.bounds[0] < -180 || atlas.bounds[2] > 180 || atlas.bounds[1] < -85 || atlas.bounds[3] > 85 ||
    atlas.bounds[0] >= atlas.bounds[2] || atlas.bounds[1] >= atlas.bounds[3] ||
    !Array.isArray(atlas.days) || !atlas.days.length || !atlas.days.every((day) => Number.isInteger(day) && day >= 1 && day <= 365) ||
    new Set(atlas.days).size !== atlas.days.length || (atlas.kind === "era5" && atlas.days.length !== 365) ||
    !Array.isArray(atlas.colors) || atlas.colors.length < 2 || atlas.colors.some((stop, index) =>
      !Number.isFinite(stop.value) || !/^#[0-9a-f]{6}$/i.test(stop.color) || (index > 0 && stop.value <= atlas.colors[index - 1].value))) {
    throw new Error("The local atlas is incomplete or uses an incompatible averaging method.");
  }
  return atlas;
}

export function temperatureTileUrl(base: string, day: number) {
  return `seasonatlas-weather://${base.replace(/\/$/, "")}/${day}/{z}/{x}/{y}.png`;
}

export function attachTemperature(map: Map, base: string, atlas: TemperatureAtlas, day: number, opacity: number, slot = 0) {
  const source = `${TEMPERATURE_SOURCE}-${slot}`;
  const layer = `${TEMPERATURE_LAYER}-${slot}`;
  map.addSource(source, {
    type: "raster", tiles: [temperatureTileUrl(base, day)], bounds: atlas.bounds,
    minzoom: atlas.minzoom, maxzoom: atlas.maxzoom, tileSize: 256,
    attribution: 'Daily temperature: <a href="https://cds.climate.copernicus.eu/datasets/derived-era5-single-levels-daily-statistics">Copernicus ERA5</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
  });
  map.addLayer({ id: layer, type: "raster", source,
    paint: { "raster-opacity": opacity, "raster-opacity-transition": { duration: 0 }, "raster-resampling": "linear", "raster-fade-duration": 0 },
  }, "coastline");
  return () => {
    if (map.getLayer(layer)) map.removeLayer(layer);
    if (map.getSource(source)) map.removeSource(source);
  };
}

