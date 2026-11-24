"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { ANNUAL_DATASET, MONTH_CENTRES, annualValue, type AnnualTemperature } from "@/lib/weather/annual";
import { formatHour, formatSeasonalDate, MONTHS } from "@/lib/seasonalTime";
import { useExplorationStore } from "@/state/explorationStore";
import { createAnnualPagesLoader } from "@/lib/weather/annualPages";

const cache = new Map<string, AnnualTemperature>();
const pagesBase = process.env.NEXT_PUBLIC_TEMPERATURE_TILE_URL;
const loadAnnualPages = createAnnualPagesLoader();
type Result = { key: string; data?: AnnualTemperature; error?: string };
const W = 312, H = 180, LEFT = 32, RIGHT = 8, TOP = 12, BOTTOM = 30;
const x = (day: number) => LEFT + (day - 1) / 364 * (W - LEFT - RIGHT);

export function AnnualTemperatureChart() {
  const location = useExplorationStore((state) => state.selectedLocation);
  const day = useExplorationStore((state) => state.dayOfYear);
  const hour = useExplorationStore((state) => state.hour);
  const setDay = useExplorationStore((state) => state.setDayOfYear);
  const latitude = location ? Number(location.latitude.toFixed(4)) : null;
  const longitude = location ? Number(location.longitude.toFixed(4)) : null;
  const key = `${ANNUAL_DATASET},${latitude},${longitude},${hour}`;
  const [result, setResult] = useState<Result | null>(null);
  const [retry, setRetry] = useState(0);
  const gradient = useId().replace(/:/g, "");
  const description = `${gradient}-description`;

  useEffect(() => {
    if (latitude === null || longitude === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const cached = cache.get(key);
      if (cached) { setResult({ key, data: cached }); return; }
      const params = new URLSearchParams({ latitude: String(latitude), longitude: String(longitude), hour: String(hour) });
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
      const request = pagesBase ? loadAnnualPages(pagesBase, latitude, longitude, hour, signal) :
        fetch(`/api/weather/annual?${params}`, { signal }).then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Annual temperatures could not be loaded.");
          return data;
        });
      void request.then((data) => {
        if (data.version !== 1 || data.hourUTC !== hour || data.baseline?.[0] !== 2020 || data.baseline?.[1] !== 2024 ||
          data.resolutionDegrees !== .5 || !Array.isArray(data.monthly) || data.monthly.length !== 12 ||
          data.monthly.some((value: unknown) => value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < -120 || value > 80))) {
          throw new Error("Unexpected annual temperature data.");
        }
        if (controller.signal.aborted) return;
        cache.set(key, data);
        while (cache.size > 64) cache.delete(cache.keys().next().value!);
        setResult({ key, data });
      }).catch((error) => {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "Annual temperatures could not be loaded." });
      });
    }, 150);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [key, latitude, longitude, hour, retry]);

  const current = result?.key === key ? result : null;
  const data = current?.data;
  const values = data?.monthly.filter((value): value is number => value !== null) ?? [];
  const min = Math.floor(((values.length ? Math.min(...values) : 0) - 2) / 5) * 5;
  const max = Math.max(min + 10, Math.ceil(((values.length ? Math.max(...values) : 0) + 2) / 5) * 5);
  const y = (value: number) => TOP + (max - value) / (max - min) * (H - TOP - BOTTOM);
  const marker = data ? annualValue(data.monthly, day) : null;
  const points = data ? [{ day: 1, value: annualValue(data.monthly, 1) },
    ...data.monthly.map((value, index) => ({ day: MONTH_CENTRES[index], value })),
    { day: 365, value: annualValue(data.monthly, 365) }] : [];
  const segments: string[] = [];
  let segment = "";
  for (const point of points) {
    if (point.value === null) { if (segment) segments.push(segment); segment = ""; }
    else segment += `${segment ? " L" : "M"}${x(point.day).toFixed(2)},${y(point.value).toFixed(2)}`;
  }
  if (segment) segments.push(segment);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === "Home" ? 1 : event.key === "End" ? 365 :
      ["ArrowRight", "ArrowUp"].includes(event.key) ? Math.min(365, day + (event.shiftKey ? 7 : 1)) :
      ["ArrowLeft", "ArrowDown"].includes(event.key) ? Math.max(1, day - (event.shiftKey ? 7 : 1)) : null;
    if (next !== null) { event.preventDefault(); setDay(next); }
  };

  return <section className="annual-temperature" aria-label="Annual temperature">
    <div className="weather-heading"><h3>Annual temperature</h3><span>2020–2024</span></div>
    {!current && <p className="annual-status" role="status">Loading annual temperatures…</p>}
    {current?.error && <div className="annual-status weather-error" role="status"><p>{current.error}</p>
      <button type="button" onClick={() => { setResult(null); setRetry((value) => value + 1); }}>Retry annual chart</button></div>}
    {data && values.length === 0 && <p className="annual-status" role="status">No annual temperature samples for this location.</p>}
    {data && values.length > 0 && <>
      <p className="annual-subtitle">Monthly means · {formatHour(hour)} UTC</p>
      <div className="annual-plot" role="slider" tabIndex={0} aria-label="Select day on annual temperature chart"
        aria-valuemin={1} aria-valuemax={365} aria-valuenow={day} aria-valuetext={formatSeasonalDate(day)}
        aria-describedby={description} onKeyDown={onKeyDown}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const position = (event.clientX - bounds.left) / bounds.width * W;
          setDay(Math.round(1 + Math.max(0, Math.min(1, (position - LEFT) / (W - LEFT - RIGHT))) * 364));
        }}>
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a598ff" stopOpacity=".4" /><stop offset="100%" stopColor="#8774ff" stopOpacity=".02" />
          </linearGradient></defs>
          {[0, 1, 2, 3, 4].map((step) => {
            const value = min + (max - min) * step / 4;
            return <g key={step}><line className="annual-grid" x1={LEFT} x2={W - RIGHT} y1={y(value)} y2={y(value)} />
              <text className="annual-axis" x={LEFT - 5} y={y(value) + 3} textAnchor="end">{Number(value.toFixed(1))}°</text></g>;
          })}
          {segments.map((path, index) => <path key={index} d={path} fill="none" className="annual-line" />)}
          {data.monthly.every((value) => value !== null) && <path d={`${segments[0]} L${x(365)},${H - BOTTOM} L${x(1)},${H - BOTTOM} Z`} fill={`url(#${gradient})`} />}
          {data.monthly.map((value, index) => value === null ? null : <circle key={index} className="annual-dot" cx={x(MONTH_CENTRES[index])} cy={y(value)} r="2.5" />)}
          <line className="annual-marker" x1={x(day)} x2={x(day)} y1={TOP} y2={H - BOTTOM} />
          {marker !== null && <circle className="annual-selected" cx={x(day)} cy={y(marker)} r="4" />}
          {MONTHS.map((month, index) => <text className="annual-axis annual-month" key={month.short} x={x(MONTH_CENTRES[index])} y={H - 10} textAnchor="middle">{month.short}</text>)}
        </svg>
      </div>
      <p className="annual-selected-date">Selected · {formatSeasonalDate(day)}</p>
      <p id={description} className="annual-help">Click to jump · arrow keys move a day</p>
      <details className="annual-details"><summary>Monthly values &amp; method</summary>
        <p>ERA5 · 0.5° grid, matching the map. Monthly means of the 15-day-smoothed seasonal averages at the selected UTC hour. The marker follows the interpolated monthly curve; it is not a daily reading.</p>
        <div className="annual-month-values">{MONTHS.map((month, index) => <button type="button" key={month.short}
          onClick={() => setDay(Math.round(MONTH_CENTRES[index]))} aria-label={`Jump to mid-${month.name}`}>
          <span>{month.short}</span><strong>{data.monthly[index]?.toFixed(1) ?? "—"}{data.monthly[index] !== null ? " °C" : ""}</strong>
        </button>)}</div>
      </details>
    </>}
  </section>;
}
