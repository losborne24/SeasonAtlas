"use client";

import { useEffect, useState } from "react";
import { MONTHS, calendarDate } from "../seasonalTime";
import { useExplorationStore } from "@/state/explorationStore";
import { WEATHER_DATASET, CLIMATE, type ClimateMonth } from "./climate";

const cache = new Map<string, ClimateMonth>();
type Result = { key: string; data?: ClimateMonth; error?: string };

export function useHistoricalWeather() {
  const location = useExplorationStore((state) => state.selectedLocation);
  const day = useExplorationStore((state) => state.dayOfYear);
  const hour = useExplorationStore((state) => state.hour);
  const month = MONTHS.indexOf(calendarDate(day).month) + 1;
  const latitude = location ? Number(location.latitude.toFixed(4)) : null;
  const longitude = location ? Number(location.longitude.toFixed(4)) : null;
  const key = location ? `${WEATHER_DATASET},${latitude},${longitude},${month}` : "";
  const [result, setResult] = useState<Result | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (latitude === null || longitude === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // Stop at an uncached month so playback cannot launch dozens of provider jobs.
      if (!cache.has(key)) useExplorationStore.getState().setPlaying(false);
      const cached = cache.get(key);
      if (cached) { setResult({ key, data: cached }); return; }
      const url = `/api/weather?${new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), month: String(month), dataset: WEATHER_DATASET })}`;
      void fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(100000)]) }).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Historical weather could not be loaded.");
        if (data.version !== 1 || data.month !== month || !data.values || !data.counts ||
          data.baseline?.startYear !== CLIMATE.startYear || data.baseline?.endYear !== CLIMATE.endYear || data.radius !== CLIMATE.radius) {
          throw new Error("Unexpected weather response.");
        }
        if (controller.signal.aborted) return;
        cache.set(key, data);
        while (cache.size > 24) cache.delete(cache.keys().next().value!);
        setResult({ key, data });
      }).catch((error) => {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "Historical weather could not be loaded." });
      });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, latitude, longitude, month, retry]);

  // Never show a previous location's or month's values during a new lookup.
  const current = result?.key === key ? result : null;
  const data = current?.data;
  const index = data ? (day - data.startDay) * 24 + hour : 0;
  return { data, index, loading: !!location && !current, error: current?.error, retry: () => {
    setResult(null); setRetry((value) => value + 1);
  } };
}
