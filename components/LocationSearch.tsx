"use client";

import { useEffect, useRef, useState } from "react";
import { formatCoordinates, parseCoordinates, searchCities, SUGGESTED_CITIES } from "@/lib/locations";
import { useExplorationStore, type SelectedLocation } from "@/state/explorationStore";

interface SearchResponse {
  query: string;
  status: "loading" | "ready" | "error";
  results: SelectedLocation[];
}

export function LocationSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [retry, setRetry] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const selectLocation = useExplorationStore((state) => state.selectLocation);
  const trimmed = query.trim();
  const coordinates = parseCoordinates(trimmed);
  const coordinateLike = /^[+\-\d.\s,]+$/.test(trimmed) && trimmed.includes(",");

  useEffect(() => {
    if (!open || trimmed.length < 2 || parseCoordinates(trimmed) || coordinateLike) return;
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      setResponse({ query: trimmed, status: "loading", results: [] });
      deadline = setTimeout(() => {
        controller.abort();
        setResponse({ query: trimmed, status: "error", results: [] });
      }, 10000);
      void searchCities(trimmed, controller.signal).then((results) => {
        if (!controller.signal.aborted) setResponse({ query: trimmed, status: "ready", results });
      }).catch(() => {
        if (!controller.signal.aborted) setResponse({ query: trimmed, status: "error", results: [] });
      }).finally(() => clearTimeout(deadline));
    }, 300);
    return () => { clearTimeout(timer); clearTimeout(deadline); controller.abort(); };
  }, [trimmed, open, retry, coordinateLike]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  const current = response?.query === trimmed ? response : null;
  const results = !trimmed ? SUGGESTED_CITIES : coordinates ? [coordinates] : coordinateLike ? [] : current?.results ?? [];
  const loading = trimmed.length >= 2 && !coordinateLike && !coordinates && (!current || current.status === "loading");
  const failed = current?.status === "error" && !coordinates && !coordinateLike;

  function choose(location: SelectedLocation) {
    selectLocation(location);
    setQuery(location.source === "coordinates" ? `${location.latitude}, ${location.longitude}` : location.name);
    setOpen(false);
    setActive(-1);
    input.current?.blur();
  }

  return (
    <div className="location-search" ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <form className={`search-field ${open ? "is-open" : ""}`} role="search" onSubmit={(event) => {
        event.preventDefault();
        if (open && results.length) choose(results[active >= 0 ? active : 0]);
        else setOpen(true);
      }}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        <input
          ref={input}
          aria-label="Search city or coordinates"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="location-results"
          aria-activedescendant={open && active >= 0 && results[active] ? `location-option-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search a city or coordinates…"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(-1); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setOpen(false); setActive(-1); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (results.length) setActive((previous) => event.key === "ArrowDown"
                ? (previous + 1) % results.length
                : previous <= 0 ? results.length - 1 : previous - 1);
            }
          }}
        />
        {query ? <button className="search-clear" type="button" aria-label="Clear search" onClick={() => {
          setQuery(""); setActive(-1); setOpen(true); input.current?.focus();
        }}>×</button> : <span className="search-key" aria-hidden="true">⌕</span>}
      </form>
      {open && <div className="search-dropdown">
        <p className="search-caption">{!trimmed ? "Start exploring" : coordinates ? "Go to coordinates" : "Search locations"}</p>
        <ul id="location-results" role="listbox" aria-label="Locations" aria-busy={loading}>
          {results.map((location, index) => (
            <li key={`${location.latitude}-${location.longitude}-${index}`} id={`location-option-${index}`} role="option" aria-selected={active === index}
              className={`search-result ${active === index ? "is-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(location)}>
              <span className="result-pin" aria-hidden="true">⌖</span>
              <span><strong>{location.name}</strong><small>{location.source === "coordinates"
                ? formatCoordinates(location.latitude, location.longitude)
                : [location.region, location.country].filter(Boolean).join(", ")}</small></span>
              <span className="result-arrow" aria-hidden="true">↗</span>
            </li>
          ))}
        </ul>
        <div role="status" className="search-status">
          {loading && <p>Searching cities…</p>}
          {failed && <p>City search is unavailable. <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button>, enter coordinates or select the map.</p>}
          {coordinateLike && !coordinates && <p>Enter latitude (−90 to 90), longitude (−180 to 180).</p>}
          {trimmed && trimmed.length < 2 && !coordinateLike && <p>Type at least two characters to search.</p>}
          {current?.status === "ready" && !results.length && !coordinateLike && <p>No cities found. Try another name or enter latitude, longitude.</p>}
        </div>
        <p className="search-attribution">City data: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> / <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></p>
      </div>}
    </div>
  );
}
