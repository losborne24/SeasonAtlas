# Bundled temperature atlas — no separate tile server required

## Current worldwide workflow: public ARCO-ERA5

The worldwide three-hour atlas reads [Google Research’s public ERA5 mirror](https://github.com/google-research/arco-era5)
directly over HTTPS. No account, API token, cloud compute or Copernicus processing
queue is involved. The existing Copernicus daily workflow below is retained for
reproducing legacy Europe assets.

```sh
python3 -m venv .weather-venv
.weather-venv/bin/pip install -r scripts/weather/requirements.txt
pnpm weather:trial
pnpm weather:arco
```

`weather:trial` fetches eight real global grids for **2020-07-15** and renders
680 tiles. This is an explicitly labelled historical sample, **not a seasonal
average**. To inspect it in development, copy its version directory from
`.weather-data/tiles/global-temperature-hourly-trial-128-v1` into `public/weather/`
and open `/?weatherTrial=1`. This development-only mode cannot become the active
production atlas. It supplies only July 15; choosing another day retains the
last frame and reports missing coverage.

`weather:arco` fetches temperature at **00, 03, 06, 09, 12, 15, 18 and 21 UTC**
for **2020–2024**, omitting February 29: 14,600 source frames. Each compressed
chunk contains one hour of the native 721 × 1440, 0.25° grid. Downloading a coarser
slice cannot avoid reading that whole chunk. Four bounded download threads are
used against the public object store; this is independent of CDS request rules.
Retries use bounded backoff. Temperature units, coordinates and actual time
coordinates are checked before a frame is accepted.

Native temperatures are reduced to **361 × 720, 0.5° cells** using cosine-latitude
area weights and trapezoidal integration over each ±0.25° cell footprint.
Longitude wraps at the date line; polar footprints are clipped. Kelvin is
converted to Celsius. No model elevation downscaling is applied.

For each of the eight UTC hours, the selected calendar date **±7 days** is
averaged across five years, giving **75 year-day samples per cell**. The window
wraps over December/January without extending the baseline. Missing coverage
fails generation instead of silently substituting values. Independent raw-cache
reference means check January/July and several locations, including the seam
and poles. Point weather also uses the selected UTC hour, but its native 0.25°
grid differs from the overlay’s spatial average.

The output is **365 × 8 × 85 = 248,200 PNG tiles**, 128 pixels, zooms 0–3.
Bilinear display interpolation and crossfades smooth the appearance; zooming
further adds no weather detail. The one-day sample measured 7.73 MB of PNGs,
projecting to **2.82 GB** for the finished atlas. Source transfer projects to
roughly **34 GB**; locally cached coarse arrays take about **15 GB**, with
additional working space during aggregation. Actual annual totals can differ.

Progress and errors are written to `.weather-data/arco/status.json`. Redirect
stdout to `.weather-data/arco/world.log` for a persistent log. SHA-256 source
provenance and coarse-cache checksums live beside `.weather-data/arco/samples/`.
Restarting the same command reuses verified samples and completed hour builds;
a file lock prevents competing world runs. Cached files and working arrays are
ignored by Git and do not ship with the app.

Every output PNG is decoded and checked before the complete manifest is written.
The installer then publishes ordinary files under
`public/weather/global-temperature-2020-2024-3hour-05deg-128-v1/` and atomically
switches `public/weather/manifest.json` last. The old active atlas remains
available throughout generation. Reload after completion; restart an already
running production server after adding new static files. Versioned PNGs receive
immutable browser caching. The map maintains at most two frame sources, retaining
the last frame through loading or failures. No archive or external tile server
is required.

Validation commands:

```sh
.weather-venv/bin/python scripts/weather/check_arco.py
pnpm weather:check
node scripts/check-weather.mjs
pnpm typecheck
pnpm lint
pnpm build
```

## Annual temperature chart

`pnpm weather:annual` builds annual curves from the already-validated
`.weather-data/arco/work/frames-XX.npy` arrays, without another source download.
The full `weather:arco` pipeline runs this step automatically before installation.
It bundles eight half-degree global grids with 12 monthly values per cell under
`public/weather/annual-temperature-2020-2024-05deg-v1/`. Retain this folder when
shipping the app alongside the main raster atlas.

Each monthly value averages the month’s 15-day-smoothed seasonal temperatures at
the same UTC hour. Values are stored as signed little-endian centidegrees, with
the 12 months adjacent per cell. The binary grids total **49,904,640 bytes**
(about 50 MB). Generation verifies independent monthly reference values at several
locations and records checksums; reruns verify and reuse the installed files.

`/api/weather/annual?latitude=48.8566&longitude=2.3522&hour=15` performs four small
local reads and bilinear interpolation, wrapping longitude at the date line.
It returns only 12 temperatures. No provider requests occur for annual charts.
Hour values must be multiples of three from 0 to 21 UTC. Invalid parameters get
HTTP 400; unavailable assets get HTTP 503 with an explicit retry state in the UI.

The chart’s selected-day marker is interpolated between monthly centres, not a
daily measurement. Clicking/tapping selects the corresponding day on the timeline.
Arrow keys step a day, Shift+arrow a week, and Home/End choose the year boundaries.
Monthly values are also available as labelled buttons. Client caching avoids new
requests on day changes; city/hour changes clear stale values while loading.

Checks: `node scripts/check-annual.mjs`, typecheck/lint/build, and desktop/mobile
browser checks. API monthly values were independently compared against the source
frames at Paris, Sydney, the date line and the North Pole within 0.01 °C rounding.

## Legacy daily atlas from Copernicus

The point-weather panel uses Open-Meteo. This legacy pipeline builds
map rasters from the free Copernicus ERA5 daily-statistics product:

1. Download monthly 2 m temperature grids for the selected baseline: 2020–2024
   worldwide, with legacy 2015–2024 assets retained separately.
2. Use the provider's daily mean, computed from all 24 hourly samples in UTC.
3. Convert Kelvin to Celsius, omit February 29, and average the selected date ±7
   days across the selected baseline years. January/December windows wrap within the
   same baseline, without adding 2014 or 2025.
4. Render a sparse Web Mercator PNG pyramid for days 1–365, zooms 0–4.
5. Serve those files locally; the map timeline chooses the day folder.

No weather-provider requests occur while navigating the overlay. The hour slider
still controls point statistics; it does **not** alter the daily map layer. Daily
UTC means and individual UTC-hour values are different statistics and should
not be expected to match. The overlay does not apply elevation downscaling.

### Legacy worldwide generation and app delivery

```sh
pnpm weather:world
```

This runs the complete **2020–2024** worldwide workflow (60 months): strictly sequential provider
requests with a short gap between them, monthly downloads with persistent remote job IDs, a
disk-backed global aggregation, latitude-band smoothing, four local tile-render
workers, verification, then installation into `public/weather/global-temperature-2020-2024-v1`.
Copernicus may queue or process these requests for a considerable time. Logs are
in `.weather-data/world.log` and `.weather-data/world-jobs/`; the current stage
and completed month count are in `.weather-data/world-status.json`. A 20-second
heartbeat also records the active month and last provider state, so a queued
request is distinguishable from a stopped local runner.

Completed downloads are reused. Interrupted submitted jobs are resumed by ID
rather than silently submitting duplicates. The pipeline reports failures and
retains completed work for a subsequent run. A `.weather-data/world.lock` file
prevents two pipelines running simultaneously; its operating-system lock is
released when the process ends.

The builder reads the 0.25° source grid including the poles. Longitude wraps
periodically at ±180°, and tiles cover the standard Web Mercator latitude range
of approximately ±85.051129°. This is the map tile projection's limit. Smoothing
uses 16-row latitude bands instead of holding the world's arrays in RAM; temporary
memory-mapped arrays live under `.weather-data/work/`. Allow additional disk space
for these intermediate arrays, beyond the final source and tile sizes.

The current global build uses five years and 75 year-day samples per 15-day
window. Existing 2015–2024 assets retain their original label; installing a rebuilt
five-year regional or world atlas switches the active manifest without relabelling old data. Old downloaded records are preserved but
excluded from the new build. Fewer source years reduce source downloads and
aggregation work; they do not reduce the 365 daily output frames.

Only generated PNGs, metadata and attribution are installed beside the app.
`public/weather/manifest.json` is switched atomically **after** the complete
versioned folder is in place. An existing Europe atlas remains active until
that succeeds. Refresh the app after completion to load the new manifest.
Restart an already-running production server after installing new static assets.

The default app URL is now `/weather`: the browser loads files from the same
origin as the app. No Python tile server is required. Static versioned PNGs
receive long-lived cache headers; the small active manifest is revalidated.
Raw ERA5 records, credentials, Python packages and working arrays are **not** part
of the shipped application. Keep `public/weather/` in the distributed app folder;
it is ignored by Git because the generated dataset is large. Do not delete the
active version's files while a running app is using it.

To install an already-built version independently:

```sh
pnpm weather:install --source .weather-data/tiles/global-temperature-2020-2024-v1
```

The installer uses ordinary files (hard links on the same filesystem, copies
otherwise). No tile archives or special browser storage format are needed.

## One-time local setup

```sh
python3 -m venv .weather-venv
.weather-venv/bin/pip install -r scripts/weather/requirements.txt
```

Python 3.9+ is supported. The Python environment, raw data and generated tiles are
ignored by Git. They are never bundled into Next.js or uploaded by this workflow.

Create a free [Copernicus account](https://cds.climate.copernicus.eu/), then follow
[CDS API setup](https://cds.climate.copernicus.eu/en/how-to-api). Put the personal
access token in `~/.cdsapirc` locally, with permissions such as `chmod 600
~/.cdsapirc`. Do not commit or paste the token into chat.

Before downloading, sign in and accept the licence for the
[ERA5 daily-statistics dataset](https://cds.climate.copernicus.eu/datasets/derived-era5-single-levels-daily-statistics?tab=download#manage-licences).
This is a separate acceptance from the hourly ERA5 dataset. A 403 mentioning
required licences means this acceptance still needs to be completed.

## Optional Europe-only download and legacy tile server

Review a request without using credentials or downloading anything:

```sh
pnpm weather:fetch --years 2015 --months 1 --dry-run
```

Download and inspect a first month, then fetch the remaining baseline:

```sh
pnpm weather:fetch --years 2015 --months 1
pnpm weather:fetch
pnpm weather:build --start-year 2020 --end-year 2024 --output .weather-data/tiles/europe-temperature-2020-2024-v1
pnpm weather:serve
```

Downloads cover 34°–72° N, 25° W–45° E at native 0.25° resolution. The uncompressed
temperature arrays alone are approximately 0.63 GB across the baseline; allow
additional space for downloaded NetCDF/ZIP files, temporary extraction and raster tiles. CDS queues may
take considerable time. The current five-year baseline needs 60 monthly requests, executed sequentially.
The downloader validates both direct NetCDF responses (observed for single-variable
requests) and zipped NetCDF responses. Completed downloads are reused only when the matching request record is present;
interrupted `.part` files are not treated as completed months.

The builder requires every non-leap baseline date exactly once, consistent grids,
Kelvin source units and a complete 75-sample window for the five-year baseline (150 for legacy ten-year data) at each displayed cell.
Missing cells remain transparent rather than being filled with invented values.
It retains source SHA-256 checksums in `manifest.json`, plus a `NOTICE.txt`.
The manifest is written last, after every tile is built. Interrupted builds must
be rerun into a fresh output version directory; existing tiles are not overwritten.

For same-origin app serving, install the Europe atlas and run the app:

```sh
pnpm weather:install --source .weather-data/tiles/europe-temperature-v1
pnpm dev
```

The following separate server remains available as a legacy option. Keep
`pnpm weather:serve` running in one terminal and `pnpm dev` in another, and set
the public URL override below.
Open **Globe settings → Weather overlay → Daily temperature**. The controls
include an opacity slider and a Celsius colour legend. The app starts with the
overlay enabled, and reports missing metadata/tiles without breaking the base map.

Legacy separate-server atlas URL:

```text
http://127.0.0.1:8767/europe-temperature-v1
```

To use the legacy server or another static host, set `NEXT_PUBLIC_TEMPERATURE_TILE_URL` in `.env.local` and restart
Next.js (or rebuild production). The tile host binds to loopback and exposes only
the generated directory, not raw source files or credentials. This local HTTP URL
is intended for local development. A public HTTPS app needs an appropriate HTTPS
static tile host; no public hosting or paid account is configured here.

`validate.py` checks every real PNG and source checksum, then independently
recalculates January 1 and July 15 reference pixels from the raw daily grids.
Those checks cover both an ordinary summer window and the year-end wrap.

## Rendering and limitations

The overlay sits above geography fills but below coastlines, rivers, lakes and
borders. Its default 55% opacity keeps terrain relief visible. Tiles are bilinearly
resampled into Web Mercator; max-zoom parents are reused at city zoom. This changes
visual sampling, not the native ERA5 weather resolution. Outside the atlas bounds
there is no temperature coverage. The palette is fixed at −30 to 45 °C and clamps
out-of-range colours; it never changes scale between seasons.

Day changes keep the last complete frame visible while a second source loads,
then crossfade with constant combined opacity. Rapid scrubbing coalesces pending
frames. Controls identify the displayed day while a replacement is loading. Tile
errors retain the last complete frame, report the problem and pause playback.
Disabling the layer removes both sources and all frame listeners;
terrain, selection and projection controls remain independent.

## Verification

```sh
pnpm weather:check
.weather-venv/bin/python scripts/weather/validate.py  # after building real tiles
pnpm typecheck
pnpm lint
pnpm build
```

`weather:check` creates a small synthetic NetCDF in a temporary directory and
checks daily sampling, units, leap-day removal, full coverage, cyclic smoothing,
palette endpoints, Web Mercator interpolation and PNG output. Synthetic data is
marked in both source and manifest. Production builds refuse test atlases;
development labels them **SYNTHETIC TEST DATA · not weather**. Test fixtures are
not the application's real temperature atlas.

Data credit: [Copernicus ERA5 via CDS](https://cds.climate.copernicus.eu/datasets/derived-era5-single-levels-daily-statistics),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Derived products change
units, aggregate years/days and resample spatially. Data access is free; local
processing uses your existing computer, disk, electricity and internet connection.
