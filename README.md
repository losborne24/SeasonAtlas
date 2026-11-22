# Globebase

A subject-agnostic, interactive globe of Earth. Explore physical geography,
coastlines, rivers, lakes and terrain without a historical timeline, political
boundaries or preselected landmarks. Globebase is a foundation for world-based
experiences; the base globe makes no assumptions about their subject matter.

## Getting started

Use Node.js 20.9+ and the pnpm version pinned in `package.json`.

```sh
pnpm install
pnpm dev             # http://localhost:3000
```

Drag to explore, scroll to zoom, and use the navigation control to adjust the
camera. Open **Globe settings** to adjust terrain exaggeration and hillshade.
The initial camera looks toward the equator at the prime meridian.
Use the **2D / 3D** control at the upper right to switch between a Mercator map
and the globe. The current location, zoom and layers stay in place; switching
to 2D also resets tilt and bearing for a north-up map.

**Urban areas** are enabled by default in Globe settings. Muted warm-grey
settlement footprints fade in between zooms 2 and 5, above biomes and below
coastlines, rivers and lakes. These are generalised urban extents, without
individual buildings or city labels.

The base globe needs no account, backend, generated biome tiles or API key.
Mapterhorn elevation tiles load over the network; unavailable elevation does
not prevent navigation or the local physical geography from rendering.

## Optional biome colours

Biome raster tiles are generated offline and served independently of Next.js.
Set `NEXT_PUBLIC_BIOME_TILE_URL` in `.env.local` to a tile pyramid base URL
containing `tilejson.json`, then restart development or rebuild for production.
There is no default biome service or connection to another project's hosting.

To start both the app and local tiles together, use `pnpm dev:biomes` instead.
This sets the biome URL to `http://127.0.0.1:8766/pnv-v4-global` for that run
and stops both servers on Ctrl+C. The generated `pnv-v4-global` pyramid must
already exist under `.biome-data/tiles/`.

Alternatively, serve generated local tiles in a separate terminal:

```sh
pnpm biomes:serve
```

Then configure `.env.local`:

```dotenv
NEXT_PUBLIC_BIOME_TILE_URL=http://localhost:8766/pnv-v4-global
```

See [global biome generation and hosting](docs/global-biomes.md) for generation,
licensing and deployment. Missing biome tiles leave the base globe usable.
Use your own R2 bucket and credentials; the uploader defaults to the local AWS
profile `globebase-r2`, overridable with `R2_PROFILE`.

## Architecture

- `app/`: page shell, metadata, fonts and global styling.
- `components/`: client-only globe lifecycle, navigation hints, globe settings,
  rendering diagnostics and loading/error states.
- `map/`: MapLibre style, coastline detail, physical terrain, hillshade and
  optional biome rasters.
- `state/explorationStore.ts`: serializable camera state, independent of datasets.
- `public/geo/`: locally hosted Natural Earth geography and vector tiles.
- `scripts/`: reproducible geography preparation, biome generation and checks.

MapLibre owns the globe and WebGL lifecycle. Its worker is emitted as a bundled
asset through a static `new URL(...)` reference. Runtime renderer objects stay
outside shared application state. Camera changes are mirrored into the store
on `moveend`; the store does not drive the camera back.

## Data and attribution

Natural Earth v5.1.2 provides local 50m global land, lakes and rivers, with 10m
regional coastlines loaded as vector tiles. Natural Earth is public domain;
Globebase retains voluntary attribution. See the [vendored data notes](public/geo/natural-earth-v5.1.2/README.md)
for provenance and reproducible preparation.

Natural Earth urban areas (dataset v4.0.0, vendored from the pinned v5.1.2
repository) add 11,878 settlement footprints as 341 local vector tiles at
zooms 0–4, totalling approximately 3.9 MB. Only visible tiles are requested;
closer zooms reuse z4. The source describes these outlines as derived from
2002–2003 MODIS imagery at 1 km resolution: they do not represent current
urban growth or precise building boundaries. See the
[dataset description](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-urban-area/).
Rebuild with `node scripts/prepare-urban-areas.mjs` (or pass a local original
GeoJSON path). The script verifies the upstream SHA-256 and uses existing
MapLibre tiling dependencies; it adds no packages. Provenance and checksum
are in the vendored data notes.

Mapterhorn supplies remote Terrarium elevation tiles through native zoom 12,
with attribution retained in the map. Terrain defaults to 1× elevation.
Optional OpenLandMap potential natural vegetation tiles retain their ODbL
notices and attribution. These describe vegetation potential, not observed
current land cover. The geography is a static physical baseline.

## Validation

```sh
pnpm typecheck
pnpm lint
pnpm build
node scripts/check-geography.mjs
node scripts/check-hillshade.mjs
```

`node scripts/check-biomes.mjs` additionally validates a generated biome pyramid
when local tiles are available.

## Limits

Natural Earth coastlines and water are generalized, even at regional zoom.
They may not match the elevation surface exactly. Biome resolution is limited
by source data and the generated pyramid. Elevation and configured biome
services need network access. WebGL 2 is required; an explanatory fallback is
shown when unavailable. Rendering diagnostics are shown on wider screens.

The documents in `docs/` retain earlier terrain and biome implementation
records, including observations of interface features that have since been
removed. This README describes the current application.
