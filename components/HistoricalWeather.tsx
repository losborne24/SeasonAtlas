"use client";

import { useHistoricalWeather } from "@/lib/weather/useHistoricalWeather";
import { VARIABLES } from "@/lib/weather/climate";

const METRICS = [
  { variable: "temperature_2m", label: "Temperature", unit: "°C", digits: 1 },
  { variable: "wind_speed_10m", label: "Wind", unit: "km/h", digits: 1 },
  { variable: "precipitation", label: "Precipitation", unit: "mm", digits: 2 },
] as const;

export function HistoricalWeather() {
  const { data, index, loading, error, retry } = useHistoricalWeather();
  if (loading) return <div className="weather-status" role="status"><span className="weather-spinner" aria-hidden="true" />
    <p>Preparing historical averages…<small>First lookup of a month can take up to 90 seconds. Playback pauses while it loads.</small></p></div>;
  if (error) return <div className="weather-status weather-error" role="status"><p>{error}</p><button type="button" onClick={retry}>Retry weather</button></div>;
  if (!data) return null;
  const coverage = Math.min(...VARIABLES.map((variable) => data.counts[variable][index]));
  const missing = METRICS.every(({ variable }) => data.values[variable][index] === null);
  return (
    <div className="historical-weather">
      <div className="weather-heading"><h3>Historical averages</h3><span>{data.baseline.startYear}–{data.baseline.endYear}</span></div>
      <dl className="weather-metrics">
        {METRICS.map(({ variable, label, unit, digits }) => {
          const value = data.values[variable][index];
          return <div key={variable}><dt>{label}</dt><dd>{value === null ? "—" : value.toFixed(digits)} <small>{value === null ? "" : unit}</small></dd></div>;
        })}
      </dl>
      <p className="weather-method">{data.radius ? `${data.radius * 2 + 1}-day window · same UTC hour` : "Exact calendar day · same UTC hour"}</p>
      {missing ? <p className="weather-coverage" role="status">No samples for this day and hour.</p> : coverage < data.expectedSamples &&
        <p className="weather-coverage">Incomplete coverage · {coverage}/{data.expectedSamples} year-day samples at minimum.</p>}
      <details className="weather-provenance"><summary>About these averages</summary>
        <p>ERA5 reanalysis · {data.grid.resolution}. Map zoom does not increase weather resolution.</p>
        <p>Model cell: {data.grid.latitude.toFixed(2)}°, {data.grid.longitude.toFixed(2)}°. Time basis: {data.timezone}.</p>
        <p>{data.radius ? `Selected date ±${data.radius} days, averaged across the baseline years.` : "Selected calendar date, averaged across the baseline years."} Missing values are excluded. UTC keeps the panel and worldwide map on one clock; leap day is omitted.</p>
        <p>Precipitation is the average total in the preceding hour, including dry hours; it is not the probability of rain.</p>
        <p>Temperature at 2 m; wind speed at 10 m. Model grid values, without elevation downscaling.</p>
      </details>
      <p className="weather-attribution">Averages calculated from <a href="https://open-meteo.com/en/docs/historical-weather-api" target="_blank" rel="noreferrer">Open-Meteo</a> / <a href="https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels" target="_blank" rel="noreferrer">Copernicus ERA5</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></p>
    </div>
  );
}
