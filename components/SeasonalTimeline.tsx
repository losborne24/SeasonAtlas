"use client";

import { useEffect } from "react";
import { calendarDate, DAYS_IN_YEAR, formatHour, formatSeasonalDate, MONTHS, PLAYBACK_SPEEDS, seasonForDay, type PlaybackSpeed } from "@/lib/seasonalTime";
import { useExplorationStore } from "@/state/explorationStore";

export function SeasonalTimeline() {
  const day = useExplorationStore((state) => state.dayOfYear);
  const hour = useExplorationStore((state) => state.hour);
  const playing = useExplorationStore((state) => state.isPlaying);
  const speed = useExplorationStore((state) => state.playbackSpeed);
  const setDay = useExplorationStore((state) => state.setDayOfYear);
  const setHour = useExplorationStore((state) => state.setHour);
  const setPlaying = useExplorationStore((state) => state.setPlaying);
  const setSpeed = useExplorationStore((state) => state.setPlaybackSpeed);
  const stepDay = useExplorationStore((state) => state.stepDay);
  const { month } = calendarDate(day);

  useEffect(() => {
    if (!playing) return;
    // A hidden tab should not advance seasons unnoticed or consume animation work.
    const onVisibility = () => {
      if (document.hidden) useExplorationStore.getState().setPlaying(false);
    };
    const timer = window.setInterval(() => {
      if (!document.hidden) useExplorationStore.getState().advancePlayback();
    }, 500 / speed);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [playing, speed]);

  return (
    <section className="seasonal-timeline" aria-label="Seasonal timeline">
      <div className="timeline-top">
        <div className="timeline-playback">
          <button type="button" className="timeline-play" aria-label={playing ? "Pause seasonal playback" : "Play seasons"}
            aria-pressed={playing} onClick={() => setPlaying(!playing)}>{playing ? "Ⅱ" : "▶"}</button>
          <select aria-label="Playback speed" value={speed} title="At 1×, playback advances two days per second"
            onChange={(event) => setSpeed(Number(event.target.value) as PlaybackSpeed)}>
            {PLAYBACK_SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
          </select>
        </div>
        <div className="timeline-date"><strong>{formatSeasonalDate(day)}</strong><span>Day {day} / {DAYS_IN_YEAR} <span className="timeline-season">· {seasonForDay(day)}</span></span></div>
        <div className="timeline-step">
          <button type="button" aria-label="Previous day" onClick={() => stepDay(-1)}>‹</button>
          <button type="button" aria-label="Next day" onClick={() => stepDay(1)}>›</button>
        </div>
      </div>
      <div className="timeline-seasons" aria-hidden="true"><span>❄ Winter</span><span>✿ Spring</span><span>☀ Summer</span><span>♧ Autumn</span><span>❄</span></div>
      <input className="timeline-day" type="range" min="1" max={DAYS_IN_YEAR} step="1" value={day}
        aria-label="Day of year" aria-valuetext={`${formatSeasonalDate(day)}, day ${day} of ${DAYS_IN_YEAR}`}
        onChange={(event) => setDay(Number(event.target.value))} />
      <div className="timeline-months" role="group" aria-label="Jump to month">
        {MONTHS.map((item) => <button type="button" key={item.short} aria-label={`Jump to ${item.name}`}
          aria-pressed={item.start === month.start} onClick={() => setDay(item.start)}>{item.short}</button>)}
      </div>
      <div className="timeline-hour">
        <label htmlFor="seasonal-hour">UTC <output htmlFor="seasonal-hour">{formatHour(hour)}</output></label>
        <span aria-hidden="true">00</span>
        <input id="seasonal-hour" type="range" min="0" max="21" step="3" value={hour} aria-label="Hour of day"
          aria-valuetext={`${formatHour(hour)} UTC`} onChange={(event) => setHour(Number(event.target.value))} />
        <span aria-hidden="true">21</span>
        <span className="timeline-calendar-note" title="Yearless 365-day calendar; seasons shown for Europe">365-day calendar · Europe seasons</span>
      </div>
    </section>
  );
}
