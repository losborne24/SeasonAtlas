import type { ErrorEvent, Map } from "maplibre-gl";
import { attachTemperature, TEMPERATURE_LAYER, TEMPERATURE_SOURCE, type TemperatureAtlas } from "./temperature";

export interface TemperatureFrameStatus {
  displayedDay: number | null;
  pendingDay: number | null;
  error?: string;
}

type Frame = { day: number; slot: number; remove: () => void };

/** Keep a complete frame on screen while a second source loads and crossfades. */
export class TemperatureFrames {
  private active: Frame | null = null;
  private incoming: Frame | null = null;
  private wanted = 1;
  private disposed = false;
  private failed = false;
  private fading = false;
  private progress = 0;
  private animation = 0;

  constructor(private map: Map, private base: string, private atlas: TemperatureAtlas,
    private opacity: number, private report: (status: TemperatureFrameStatus) => void) {
    map.on("render", this.ready);
    map.on("error", this.onError);
  }

  private layer(frame: Frame) { return `${TEMPERATURE_LAYER}-${frame.slot}`; }
  private source(frame: Frame) { return `${TEMPERATURE_SOURCE}-${frame.slot}`; }

  setDay(day: number) {
    this.wanted = day;
    if (!this.atlas.days.includes(day)) {
      this.report({ displayedDay: this.active?.day ?? null, pendingDay: null, error: "This atlas has no frame for the selected day." });
      return;
    }
    if (!this.fading) this.prepare();
    else this.report({ displayedDay: this.active?.day ?? null, pendingDay: day });
  }

  private prepare() {
    if (this.disposed || !this.atlas.days.includes(this.wanted)) return;
    if (this.active?.day === this.wanted) {
      this.incoming?.remove(); this.incoming = null;
      this.report({ displayedDay: this.active.day, pendingDay: null });
      return;
    }
    if (this.incoming?.day === this.wanted && !this.failed) return;
    this.incoming?.remove();
    this.failed = false;
    const slot = this.active?.slot === 0 ? 1 : 0;
    this.incoming = { day: this.wanted, slot, remove: attachTemperature(this.map, this.base, this.atlas, this.wanted, 0, slot) };
    // The incoming layer is always above the outgoing one, independent of slot order.
    this.map.moveLayer(this.layer(this.incoming), "coastline");
    this.report({ displayedDay: this.active?.day ?? null, pendingDay: this.wanted });
    this.map.triggerRepaint();
  }

  private ready = () => {
    if (this.disposed || this.fading || this.failed || !this.incoming) return;
    if (!this.map.isSourceLoaded(this.source(this.incoming))) return;
    if (this.incoming.day !== this.wanted) { this.prepare(); return; }
    if (!this.active) { this.commit(); return; }
    this.fading = true;
    this.progress = 0;
    const start = performance.now();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160;
    const tick = (time: number) => {
      if (this.disposed) return;
      this.progress = duration ? Math.max(0, Math.min(1, (time - start) / duration)) : 1;
      this.paint();
      if (this.progress < 1) this.animation = requestAnimationFrame(tick);
      else this.commit();
    };
    this.animation = requestAnimationFrame(tick);
  };

  private paint() {
    const incomingAlpha = this.opacity * this.progress;
    if (this.incoming) this.map.setPaintProperty(this.layer(this.incoming), "raster-opacity", incomingAlpha);
    if (this.active) {
      // A + B(1−A) = opacity: avoid both a blank flash and a darker overlap pulse.
      const outgoingAlpha = incomingAlpha === 1 ? 0 : (this.opacity - incomingAlpha) / (1 - incomingAlpha);
      this.map.setPaintProperty(this.layer(this.active), "raster-opacity", outgoingAlpha);
    }
  }

  private commit() {
    if (!this.incoming) return;
    this.map.setPaintProperty(this.layer(this.incoming), "raster-opacity", this.opacity);
    this.active?.remove();
    this.active = this.incoming;
    this.incoming = null;
    this.fading = false;
    this.report({ displayedDay: this.active.day, pendingDay: this.active.day === this.wanted ? null : this.wanted });
    if (this.active.day !== this.wanted) this.prepare();
  }

  setOpacity(opacity: number) {
    this.opacity = opacity;
    if (this.fading) this.paint();
    else if (this.active) this.map.setPaintProperty(this.layer(this.active), "raster-opacity", opacity);
  }

  private onError = (event: ErrorEvent) => {
    if (!this.incoming || !("sourceId" in event) || event.sourceId !== this.source(this.incoming)) return;
    this.failed = true;
    cancelAnimationFrame(this.animation);
    this.fading = false;
    this.map.setPaintProperty(this.layer(this.incoming), "raster-opacity", 0);
    if (this.active) this.map.setPaintProperty(this.layer(this.active), "raster-opacity", this.opacity);
    this.report({ displayedDay: this.active?.day ?? null, pendingDay: null,
      error: "New temperature tiles could not load. The last available day remains displayed." });
  };

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.map.off("render", this.ready);
    this.map.off("error", this.onError);
    this.incoming?.remove(); this.active?.remove();
    this.incoming = this.active = null;
  }
}
