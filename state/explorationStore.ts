/** Serializable camera state, independent of any subject or dataset. */
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

interface ExplorationState {
  view: GlobeView;
  setView: (view: GlobeView) => void;
}

export const useExplorationStore = create<ExplorationState>((set) => ({
  view: DEFAULT_VIEW,
  setView: (view) => set({ view }),
}));
