"use client";

import { useState } from "react";
import type { Map } from "maplibre-gl";

/** Switch projection on the existing map, preserving its sources and camera centre. */
export function ProjectionToggle({ map }: { map: Map | null }) {
  const [projection, setProjection] = useState<"mercator" | "globe">("globe");

  function select(next: "mercator" | "globe") {
    if (!map || next === projection) return;
    map.setProjection({ type: next });
    if (next === "mercator") {
      map.easeTo({ pitch: 0, bearing: 0, duration: 300 });
    }
    setProjection(next);
  }

  return (
    <div role="group" aria-label="Map view" className="absolute right-4 top-28 z-20 flex rounded-full border border-panel-border bg-panel p-1 text-xs backdrop-blur-md sm:right-6">
      {([
        ["mercator", "2D", "2D map"],
        ["globe", "3D", "3D globe"],
      ] as const).map(([value, label, name]) => (
        <button
          key={value}
          type="button"
          aria-label={name}
          aria-pressed={projection === value}
          disabled={!map}
          onClick={() => select(value)}
          className={`rounded-full px-3 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 ${projection === value ? "bg-white/15 text-white" : "text-white/50 hover:text-white"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
