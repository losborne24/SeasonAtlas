"use client";

/** Identity and navigation hints for the world globe. */
export function TopBar() {
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-4 py-3 sm:px-6">
      <div className="flex items-baseline gap-3 select-none">
        <h1 className="text-sm font-semibold tracking-[0.25em] text-white sm:text-base">
          GLOBEBASE
        </h1>
        <span className="hidden text-[10px] uppercase tracking-widest text-white/40 sm:inline">
          Explore Earth
        </span>
      </div>
      <p className="hidden pr-10 text-xs text-white/50 sm:block">Drag to explore · Scroll to zoom</p>
    </header>
  );
}
