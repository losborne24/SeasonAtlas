"use client";

export function TopBar() {
  return (
    <header className="season-header">
      <div className="season-brand">
        <svg viewBox="0 0 44 44" fill="none" aria-hidden="true">
          <circle cx="22" cy="22" r="20" stroke="currentColor" strokeWidth="1.5" />
          <path d="m6 30 10-14 7 9 5-6 10 11H6Z" fill="currentColor" fillOpacity=".18" />
          <path d="m6 30 10-14 7 9 5-6 10 11M12 35h20" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <circle cx="30" cy="12" r="2.5" fill="currentColor" />
        </svg>
        <div>
          <h1>SeasonAtlas</h1>
          <p>A world to explore. A season to discover.</p>
        </div>
      </div>
      <div className="explore-badge"><span aria-hidden="true">◎</span> Explore</div>
      <p className="season-header-hint">Drag to explore <span>·</span> Scroll to zoom</p>
    </header>
  );
}
