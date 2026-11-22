/** Serializable camera and location selection state; no runtime map objects. */
import { create } from "zustand";

/** A snapshot of the MapLibre globe camera. */
export interface GlobeView {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly bearing: number;
  readonly pitch: number;
}

export const DEFAULT_VIEW: GlobeView = {
  center: [0, 0],
  zoom: 1.5,
  bearing: 0,
  pitch: 0,
};

export interface SelectedLocation {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  region?: string;
  elevation?: number;
  timezone?: string;
  source: "search" | "map" | "coordinates";
}

interface ExplorationState {
  view: GlobeView;
  setView: (view: GlobeView) => void;
  selectedLocation: SelectedLocation | null;
  selectLocation: (location: SelectedLocation | null) => void;
}

export const useExplorationStore = create<ExplorationState>((set) => ({
  view: DEFAULT_VIEW,
  setView: (view) => set({ view }),
  selectedLocation: null,
  selectLocation: (selectedLocation) => set({ selectedLocation }),
}));
