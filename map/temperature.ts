import type { Map } from "maplibre-gl";

export const TEMPERATURE_BASE = process.env.NEXT_PUBLIC_TEMPERATURE_TILE_URL ?? "/weather";
export const TEMPERATURE_SOURCE = "seasonal-temperature";
export const TEMPERATURE_LAYER = "seasonal-temperature-colour";

export interface TemperatureAtlas {
  version: 1;
  kind: "era5" | "test" | "sample";
  baseline: [number, number];
  windowDays: number;
  statistic: "daily_mean" | "hourly_mean" | "instantaneous";
  hours?: number[];
  sampleDate?: string;
  timezone: "UTC";
  variable: "temperature_2m";
  bounds: [number, number, number, number];
  resolutionDegrees: number;
  minzoom: number;
  maxzoom: number;
  days: number[];
  tileSize: 128 | 256;
  format: "png";
  colors: { value: number; color: string }[];
  tileBase?: string;
  tileStorage?: "frame-pack-v1";
}

export function validateTemperatureAtlas(value: unknown): TemperatureAtlas {
  const atlas = value as TemperatureAtlas;
  if (!atlas || atlas.version !== 1 || !["era5", "test", "sample"].includes(atlas.kind) ||
    (["test", "sample"].includes(atlas.kind) && process.env.NODE_ENV !== "development") ||
    ![2015, 2020].includes(atlas.baseline?.[0]) || atlas.baseline?.[1] !== 2024 ||
    (atlas.kind === "sample" ? atlas.windowDays !== 1 || !/^2020-\d{2}-\d{2}$/.test(atlas.sampleDate ?? "") || atlas.statistic !== "instantaneous" :
      atlas.windowDays !== 15 || !["daily_mean", "hourly_mean"].includes(atlas.statistic)) ||
    (atlas.statistic === "daily_mean" ? atlas.hours !== undefined :
      !Array.isArray(atlas.hours) || atlas.hours.length !== 8 || !atlas.hours.every((hour, index) => hour === index * 3)) ||
    atlas.timezone !== "UTC" || atlas.variable !== "temperature_2m" ||
    ![128, 256].includes(atlas.tileSize) || atlas.format !== "png" || atlas.minzoom !== 0 ||
    !Number.isInteger(atlas.maxzoom) || atlas.maxzoom < 0 || atlas.maxzoom > 5 ||
    !Number.isFinite(atlas.resolutionDegrees) || atlas.resolutionDegrees <= 0 ||
    (atlas.kind === "era5" && atlas.resolutionDegrees !== (atlas.statistic === "hourly_mean" ? 0.5 : 0.25)) ||
    !Array.isArray(atlas.bounds) || atlas.bounds.length !== 4 || !atlas.bounds.every(Number.isFinite) ||
    atlas.bounds[0] < -180 || atlas.bounds[2] > 180 || atlas.bounds[1] < -85.051129 || atlas.bounds[3] > 85.051129 ||
    atlas.bounds[0] >= atlas.bounds[2] || atlas.bounds[1] >= atlas.bounds[3] ||
    !Array.isArray(atlas.days) || !atlas.days.length || !atlas.days.every((day) => Number.isInteger(day) && day >= 1 && day <= 365) ||
    new Set(atlas.days).size !== atlas.days.length || (atlas.kind === "era5" && atlas.days.length !== 365) ||
    (atlas.tileStorage !== undefined && atlas.tileStorage !== "frame-pack-v1") ||
    (atlas.tileBase !== undefined && !/^(\/weather\/[a-zA-Z0-9-]+|\.\/frames-[a-f0-9]{16})$/.test(atlas.tileBase)) ||
    !Array.isArray(atlas.colors) || atlas.colors.length < 2 || atlas.colors.some((stop, index) =>
      !Number.isFinite(stop.value) || !/^#[0-9a-f]{6}$/i.test(stop.color) || (index > 0 && stop.value <= atlas.colors[index - 1].value))) {
    throw new Error("The temperature atlas is incomplete or uses an incompatible averaging method.");
  }
  return atlas;
}

export function temperatureHour(atlas: TemperatureAtlas, hour: number) {
  return atlas.hours ? Math.floor(hour / 3) * 3 : null;
}

/** Keep relative pack paths on the manifest host, including external Pages URLs. */
export function temperatureAtlasBase(manifestBase: string, atlas: TemperatureAtlas) {
  if (!atlas.tileBase) return manifestBase.replace(/\/$/, "");
  if (atlas.tileBase.startsWith("./")) return `${manifestBase.replace(/\/$/, "")}/${atlas.tileBase.slice(2)}`;
  return /^https?:\/\//.test(manifestBase) ? new URL(atlas.tileBase, manifestBase).href : atlas.tileBase;
}

export function temperatureTileUrl(base: string, day: number, hour: number | null = null, storage?: TemperatureAtlas["tileStorage"]) {
  const protocol = storage === "frame-pack-v1" ? "seasonatlas-weather-pack" : "seasonatlas-weather";
  return `${protocol}://${base.replace(/\/$/, "")}/${hour === null ? "" : `${String(hour).padStart(2, "0")}/`}${day}/{z}/{x}/{y}.png`;
}

export function attachTemperature(map: Map, base: string, atlas: TemperatureAtlas, day: number, opacity: number, slot = 0, hour: number | null = null) {
  const source = `${TEMPERATURE_SOURCE}-${slot}`;
  const layer = `${TEMPERATURE_LAYER}-${slot}`;
  map.addSource(source, {
    type: "raster", tiles: [temperatureTileUrl(base, day, hour, atlas.tileStorage)], bounds: atlas.bounds,
    minzoom: atlas.minzoom, maxzoom: atlas.maxzoom, tileSize: atlas.tileSize,
    attribution: 'Temperature: <a href="https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels">Copernicus ERA5</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>',
  });
  map.addLayer({ id: layer, type: "raster", source,
    paint: { "raster-opacity": opacity, "raster-opacity-transition": { duration: 0 }, "raster-resampling": "linear", "raster-fade-duration": 0 },
  }, "coastline");
  return () => {
    if (map.getLayer(layer)) map.removeLayer(layer);
    if (map.getSource(source)) map.removeSource(source);
  };
}

