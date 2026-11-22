"use client";

import { formatCoordinates } from "@/lib/locations";
import { formatHour, formatSeasonalDate } from "@/lib/seasonalTime";
import { useExplorationStore } from "@/state/explorationStore";
import { HistoricalWeather } from "@/components/HistoricalWeather";

export function LocationPanel() {
  const location = useExplorationStore((state) => state.selectedLocation);
  const selectLocation = useExplorationStore((state) => state.selectLocation);
  const day = useExplorationStore((state) => state.dayOfYear);
  const hour = useExplorationStore((state) => state.hour);
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
      </div>
      <div className="location-selected-time"><span>Selected seasonal time</span><strong>{formatSeasonalDate(day)} · {formatHour(hour)}</strong><small>Local hour at the selected location</small></div>
      <HistoricalWeather />
      <details className="location-details">
        <summary>Location details</summary>
        <p className="location-detail-coordinates">{formatCoordinates(location.latitude, location.longitude)}</p>
        {(location.elevation !== undefined || location.timezone) && <dl className="location-facts">
          {location.elevation !== undefined && <div><dt>Elevation</dt><dd>{Math.round(location.elevation).toLocaleString()} m</dd></div>}
          {location.timezone && <div><dt>Time zone</dt><dd>{location.timezone.replaceAll("_", " ")}</dd></div>}
        </dl>}
      <p className="location-source">{location.source === "search" ? "City location · Open-Meteo / GeoNames" : location.source === "map" ? "Coordinates selected on the map" : "Coordinates entered in search"}</p>
      </details>
    </section>
  );
}
