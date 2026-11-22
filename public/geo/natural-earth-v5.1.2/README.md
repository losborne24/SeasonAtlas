# Globebase geography

## Urban areas

`urban-10m/{z}/{x}/{y}.pbf` contains Natural Earth urban areas v4.0.0 from
repository revision `f1890d9f152c896d250a77557a5751a93d494776` (v5.1.2).
Upstream file: `geojson/ne_10m_urban_areas.geojson`.
Upstream SHA-256: `5136ffd816a9b28c0f295e6797b4c03eaa421be80d78b90f542db4a932dd4497`.

Public domain, like the physical geography. Source description:
https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-urban-area/
The publisher describes 2002–2003 MODIS imagery at 1 km resolution; these are
generalised settlement extents, not present-day coverage or individual buildings.

`node scripts/prepare-urban-areas.mjs [original.geojson]` strips feature
properties and tiles the 11,878 source features with MapLibre's GeoJSONVT:
zooms 0–4, extent 8192, buffer 64, tolerance 1; zero-area rings collapsed by quantisation are removed. All 341 tiles (including valid
empty tiles) are stored, totalling 3,839,951 bytes. MapLibre overzooms above z4.
The layer appears above land/biomes and below coastlines/rivers/lakes; source
shoreline generalisation can differ from the physical base.

Source: Natural Earth vector release **v5.1.2**, pinned to commit
[`f1890d9f152c896d250a77557a5751a93d494776`](https://github.com/nvkelso/natural-earth-vector/tree/f1890d9f152c896d250a77557a5751a93d494776/geojson).
The global themes use **1:50,000,000** scale; regional land uses
**1:10,000,000** (50m/10m mean scale, not metres).
The release tag covers the collection; individual theme versions may differ.

| File | Retained features | Original SHA-256 |
| --- | ---: | --- |
| ne_50m_land.geojson | 1,420 | e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b |
| ne_50m_lakes.geojson | 360 | d350b75978b26fe839b797c2c529b2fb8f47fb3983c03f4964e36d5df9378a52 |
| ne_50m_rivers_lake_centerlines.geojson | 359 | f286e0ce978fde999ca2d7a78c764be08542e19b63cded52b05c12d5173ccc51 |
| ne_50m_admin_0_boundary_lines_land.geojson | 390 | 2faac4f6b34386f3d21b6e018cf151f241f00e5c936d44dd17d7d9bfb147fa48 |
| ne_10m_land.geojson → land-10m/4/{x}/{y}.pbf | 11 upstream features → 256 tiles | 1ac90796408bc6ad6911d69448485d3c4dbf2190370080368a09976e1c9f7416 |

Original files are under `geojson/` at that commit with the same filenames.
Coordinates and polygon topology are preserved. Output is compact JSON with
names, label fields and unused attributes removed. Only water `min_zoom`
attributes are retained. Reservoir polygons and lake centerlines are omitted;
natural and alkaline lakes and actual river lines are retained. Country boundary
lines additionally retain `min_zoom` from upstream `MIN_ZOOM`; all 390 segments,
including disputed and indefinite boundaries, are drawn with the same line style.
These are the pinned release's boundaries, not a live political dataset.

## Licence and source credit

Natural Earth data is **public domain**, including modified redistribution and
commercial use. Permission and attribution are not required. Globebase voluntarily
shows **“Made with Natural Earth (public domain)”**, linked to the project.
Verified against [Natural Earth's Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/)
on 2026-10-26. The data is supplied without guarantees of accuracy or fitness.
See also the [physical dataset catalogue](https://www.naturalearthdata.com/downloads/50m-physical-vectors/).

## Rebuild

From the repository root, with Node and network access:

```sh
node scripts/prepare-natural-earth.mjs
node scripts/prepare-country-borders.mjs
node scripts/prepare-regional-coastlines.mjs
node scripts/check-geography.mjs
```

For an offline rebuild, pass a directory containing the three original files:
`node scripts/prepare-natural-earth.mjs /path/to/originals`.
The script verifies original SHA-256 hashes before transforming. Generated
GeoJSON is checked in; running the application or build needs no upstream access.
Regional tiles are also checked in. To rebuild them offline, run
`node scripts/prepare-regional-coastlines.mjs /path/to/ne_10m_land.geojson`.
The script uses the tilers already installed with MapLibre; it adds no packages.
Country borders can be rebuilt offline with
`node scripts/prepare-country-borders.mjs /path/to/ne_50m_admin_0_boundary_lines_land.geojson`.
The script verifies the upstream SHA-256 and strips unused properties.

## Resolution and performance

Physical global base: **2,464,879 bytes** uncompressed, approximately **850 KB gzip**.
Country borders add **474,936 bytes** uncompressed. Actual
transfer compression depends on the hosting server. GeoJSON is fetched once per
map instance, tiled and simplified in MapLibre's existing worker. The 50m base
supplies global/continental views, avoiding an overlapping 110m download.

Regional land starts fetching visible tiles at zoom 4, then blends from 50m to
10m across zooms **4.5–5.5**. The fade waits for visible tiles to be loaded and
uses a 300 ms paint transition, including direct zoom jumps. The coarse base
stays visible while fetching detail. Zooming back out restores 50m.
All 256 regional tiles together total **2,937,114 bytes** (~1.69 MB gzip); a view
downloads only its visible tiles, never the 10 MB upstream global GeoJSON.
For example, the two tiles spanning France and neighbouring coastlines total
98,199 bytes uncompressed. No regional requests are made below zoom 4.

Regional tiles retain every source vertex before quantisation into MapLibre's
native 8,192-unit grid at z4 (~306 m at the equator, ~200 m around France), and
overzoom at higher zooms. A 32-unit buffer keeps joins continuous at tile edges. Each tile
contains land, a complementary ocean mask, and coastlines derived from the
**same 10m land rings**. Outlines are extracted before clipping to avoid drawing
tile boundaries. The ocean mask removes obsolete 50m land while leaving solid
interiors at their original colour during the fade. This is regional cartography,
not settlement-scale surveying; higher-resolution OSM coastlines remain deferred.

Global coastline lines reuse 50m land polygon rings. Ocean is a background colour
with a regional mask derived from land; no separate upstream ocean or coastline
dataset is downloaded. Lakes and rivers remain 50m. Rivers draw below
lakes; visibility follows Natural Earth's `min_zoom` values. The 30° graticule
is generated independently, fades from zoom 2.5 to 5, and has no labels. Mercator
tiling limits the grid to ±85° latitude.

This is static present-day physical geography, **not reconstructed ancient
shorelines or hydrology**. It deliberately does not respond to timeline changes.
`physical-*` sources can coexist with a future raster DEM source; this step
adds no DEM, elevation, hillshade or terrain.

## Global relief ocean masks

`ocean-50m/{z}/{x}/{y}.pbf` contains the ocean complement of the existing
`ne_50m_land.geojson` at z0–3, generated by
`node scripts/prepare-global-ocean.mjs`. This adds no geographic dataset.
85 files total 1,084,940 bytes; z0 is 124,981 bytes. The z3 polygons are
triangulated offline to preserve land holes through MapLibre 6 vector overzoom
clipping. Other levels retain compact rings. No coastlines are generated or
replaced. Natural Earth attribution and public-domain status apply unchanged.
