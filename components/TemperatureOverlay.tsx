"use client";

import { useEffect, useRef, useState } from "react";
import type { Map } from "maplibre-gl";
import { useExplorationStore } from "@/state/explorationStore";
import { TEMPERATURE_BASE, validateTemperatureAtlas, type TemperatureAtlas } from "@/map/temperature";

import { TemperatureFrames, type TemperatureFrameStatus } from "@/map/temperatureFrames";
import { formatSeasonalDate } from "@/lib/seasonalTime";

export function TemperatureOverlay({ map }: { map: Map | null }) {
  const [enabled, setEnabled] = useState(true);
  const [opacity, setOpacity] = useState(0.55);
  const [atlas, setAtlas] = useState<TemperatureAtlas | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const opacityRef = useRef(opacity);
  const frames = useRef<TemperatureFrames | null>(null);
  const [status, setStatus] = useState<TemperatureFrameStatus>({ displayedDay: null, pendingDay: null });

  useEffect(() => {
    if (!enabled || !map) return;
    const controller = new AbortController();
    let renderer: TemperatureFrames | null = null;
    const unsubscribe = useExplorationStore.subscribe((state, previous) => {
      if (state.dayOfYear !== previous.dayOfYear) renderer?.setDay(state.dayOfYear);
    });
    void fetch(`${TEMPERATURE_BASE.replace(/\/$/, "")}/manifest.json`, {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
    }).then(async (response) => {
      if (!response.ok) throw new Error("Local atlas is not available. Build and serve the ERA5 temperature data first.");
      const metadata = validateTemperatureAtlas(await response.json());
      if (controller.signal.aborted) return;
      renderer = new TemperatureFrames(map, TEMPERATURE_BASE, metadata, opacityRef.current, (next) => {
        setStatus(next);
        if (next.error) useExplorationStore.getState().setPlaying(false);
      });
      frames.current = renderer;
      setAtlas(metadata);
      renderer.setDay(useExplorationStore.getState().dayOfYear);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "Local atlas is not available. Build and serve the ERA5 temperature data first.");
    });
    return () => { controller.abort(); unsubscribe(); renderer?.destroy(); frames.current = null; };
  }, [enabled, map, retry]);

  useEffect(() => {
    opacityRef.current = opacity;
    frames.current?.setOpacity(opacity);
  }, [map, opacity, atlas]);

  return <fieldset className="temperature-controls" disabled={!map}>
    <legend>Weather overlay</legend>
    <label className="temperature-toggle"><input type="checkbox" checked={enabled} onChange={(event) => {
      setEnabled(event.target.checked); setAtlas(null); setError(""); setStatus({ displayedDay: null, pendingDay: null });
    }} /> Daily temperature</label>
    {enabled && <>
      {atlas && <>
        <label className="temperature-opacity">Opacity · {Math.round(opacity * 100)}%
          <input type="range" aria-label="Temperature opacity" min="0" max="1" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
        </label>
        <div className="temperature-legend" aria-label="Temperature colour scale in degrees Celsius">
          <div style={{ background: `linear-gradient(90deg, ${atlas.colors.map((stop) => `${stop.color} ${(stop.value - atlas.colors[0].value) / (atlas.colors.at(-1)!.value - atlas.colors[0].value) * 100}%`).join(", ")})` }} />
          <span>{atlas.colors[0].value} °C</span><span>{atlas.colors.at(-1)!.value} °C</span>
        </div>
        <p>{atlas.kind === "test" ? "SYNTHETIC TEST DATA · not weather" : "ERA5 · 2015–2024 · 15-day window"}</p>
        <p>Daily UTC mean · hour control affects the location panel only.</p>
        {status.displayedDay !== null && <p>Showing {formatSeasonalDate(status.displayedDay)}{status.pendingDay !== null ? ` · loading ${formatSeasonalDate(status.pendingDay)}` : ""}</p>}
        {status.error && <p role="status" className="temperature-error">{status.error}<button type="button" onClick={() => frames.current?.setDay(useExplorationStore.getState().dayOfYear)}>Retry tiles</button></p>}
        <p>Grid {atlas.resolutionDegrees}° · map zoom adds no weather detail.</p>
      </>}
      {!atlas && !error && <p role="status">Loading local temperature atlas…</p>}
      {error && <p role="status" className="temperature-error">{error}<button type="button" onClick={() => { setError(""); setAtlas(null); setRetry((value) => value + 1); }}>Retry atlas</button></p>}
    </>}
  </fieldset>;
}
