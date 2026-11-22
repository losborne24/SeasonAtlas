"use client";

import { formatCoordinates } from "@/lib/locations";
import { useExplorationStore } from "@/state/explorationStore";

export function LocationPanel() {
  const location = useExplorationStore((state) => state.selectedLocation);
  const selectLocation = useExplorationStore((state) => state.selectLocation);
  if (!location) return <div className="map-selection-hint">Click anywhere on the map to explore a location</div>;

  return (
    <section className="location-panel" aria-labelledby="location-heading">
      <div className="location-panel-topline"><span><span className="location-dot" /> Selected location</span>
        <button type="button" aria-label="Close location panel" onClick={() => selectLocation(null)}>×</button>
      </div>
      <div aria-live="polite" aria-atomic="true">
        <h2 id="location-heading">{location.name}</h2>
        {location.country && <p className="location-region">{[location.region, location.country].filter(Boolean).join(", ")}</p>}
        <p className="location-coordinates">⌖ {formatCoordinates(location.latitude, location.longitude)}</p>
        {(location.elevation !== undefined || location.timezone) && <dl className="location-facts">
          {location.elevation !== undefined && <div><dt>Elevation</dt><dd>{Math.round(location.elevation).toLocaleString()} m</dd></div>}
          {location.timezone && <div><dt>Time zone</dt><dd>{location.timezone.replaceAll("_", " ")}</dd></div>}
        </dl>}
      </div>
      <div className="location-next"><span aria-hidden="true">◷</span><p><strong>Every place has a season.</strong>Historical weather and seasonal charts are coming next.</p></div>
      <p className="location-source">{location.source === "search" ? "City location · Open-Meteo / GeoNames" : location.source === "map" ? "Coordinates selected on the map" : "Coordinates entered in search"}</p>
    </section>
  );
}
