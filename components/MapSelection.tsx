"use client";

import { useEffect } from "react";
import { Marker, type Map, type MapMouseEvent } from "maplibre-gl";
import { useExplorationStore } from "@/state/explorationStore";

/** Selection is independent of camera snapshots and never recreates the map. */
export function MapSelection({ map }: { map: Map | null }) {
  const location = useExplorationStore((state) => state.selectedLocation);

  useEffect(() => {
    if (!map) return;
    const select = (event: MapMouseEvent) => {
      // Sky clicks unproject to the horizon; reject points that cannot round-trip.
      if (map.project(event.lngLat).dist(event.point) > 5) return;
      const position = event.lngLat.wrap();
      useExplorationStore.getState().selectLocation({
        name: "Selected location", latitude: position.lat, longitude: position.lng, source: "map",
      });
    };
    map.on("click", select);
    return () => { map.off("click", select); };
  }, [map]);

  useEffect(() => {
    if (!map || !location) return;
    const element = document.createElement("div");
    element.className = "selection-marker";
    element.setAttribute("aria-hidden", "true");
    const marker = new Marker({ element }).setLngLat([location.longitude, location.latitude]).addTo(map);
    if (location.source !== "map") {
      const small = map.getContainer().clientWidth < 768;
      map.flyTo({
        center: [location.longitude, location.latitude],
        zoom: Math.max(map.getZoom(), 6),
        offset: small ? [0, -50] : [-150, 30],
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1500,
      });
    }
    return () => { marker.remove(); };
  }, [map, location]);

  return null;
}
