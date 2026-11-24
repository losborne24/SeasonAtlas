/** Serializable camera and location selection state; no runtime map objects. */
import { create } from "zustand";
import { DAYS_IN_YEAR, PLAYBACK_SPEEDS, wrapDay, type PlaybackSpeed } from "@/lib/seasonalTime";

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
  dayOfYear: number;
  hour: number;
  isPlaying: boolean;
  playbackSpeed: PlaybackSpeed;
  setDayOfYear: (day: number) => void;
  setHour: (hour: number) => void;
  setPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  stepDay: (offset: number) => void;
  advancePlayback: () => void;
}

export const useExplorationStore = create<ExplorationState>((set) => ({
  view: DEFAULT_VIEW,
  setView: (view) => set({ view }),
  selectedLocation: null,
  selectLocation: (selectedLocation) => set({ selectedLocation }),
  dayOfYear: 196,
  hour: 15,
  isPlaying: false,
  playbackSpeed: 1,
  setDayOfYear: (day) => {
    if (Number.isFinite(day)) set({ dayOfYear: Math.max(1, Math.min(DAYS_IN_YEAR, Math.round(day))), isPlaying: false });
  },
  setHour: (hour) => {
    if (Number.isFinite(hour)) set({ hour: Math.max(0, Math.min(21, Math.round(hour / 3) * 3)), isPlaying: false });
  },
  setPlaying: (isPlaying) => set({ isPlaying }),
  setPlaybackSpeed: (playbackSpeed) => {
    if (PLAYBACK_SPEEDS.includes(playbackSpeed)) set({ playbackSpeed });
  },
  stepDay: (offset) => {
    if (Number.isInteger(offset)) set((state) => ({ dayOfYear: wrapDay(state.dayOfYear + offset), isPlaying: false }));
  },
  advancePlayback: () => set((state) => state.isPlaying ? { dayOfYear: wrapDay(state.dayOfYear + 1) } : state),
}));
