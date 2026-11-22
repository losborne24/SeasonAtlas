# Local temperature atlas — no hosted service required

The point-weather panel continues to use Open-Meteo. This separate pipeline builds
local map rasters from the free Copernicus ERA5 daily-statistics product:

1. Download monthly European 2 m temperature grids for 2015–2024.
2. Use the provider's daily mean, computed from all 24 hourly samples in UTC.
3. Convert Kelvin to Celsius, omit February 29, and average the selected date ±7
   days across the ten baseline years. January/December windows wrap within the
   same baseline, without adding 2014 or 2025.
4. Render a sparse Web Mercator PNG pyramid for days 1–365, zooms 0–4.
5. Serve those files locally; the map timeline chooses the day folder.

No weather-provider requests occur while navigating the overlay. The hour slider
still controls point statistics; it does **not** alter the daily map layer. Daily
UTC means and individual local-hour values are different statistics and should
not be expected to match. The overlay does not apply elevation downscaling.

## One-time local setup

```sh
python3 -m venv .weather-venv
.weather-venv/bin/pip install -r scripts/weather/requirements.txt
```

Python 3.9+ is supported. The Python environment, raw data and generated tiles are
ignored by Git. They are separate from biome inputs and are never bundled into
Next.js or uploaded by this workflow.

Create a free [Copernicus account](https://cds.climate.copernicus.eu/), then follow
[CDS API setup](https://cds.climate.copernicus.eu/en/how-to-api). Put the personal
access token in `~/.cdsapirc` locally, with permissions such as `chmod 600
~/.cdsapirc`. Do not commit or paste the token into chat.

Before downloading, sign in and accept the licence for the
[ERA5 daily-statistics dataset](https://cds.climate.copernicus.eu/datasets/derived-era5-single-levels-daily-statistics?tab=download#manage-licences).
This is a separate acceptance from the hourly ERA5 dataset. A 403 mentioning
required licences means this acceptance still needs to be completed.

## Download, build and serve

Review a request without using credentials or downloading anything:

```sh
pnpm weather:fetch --years 2015 --months 1 --dry-run
```

Download and inspect a first month, then fetch the remaining baseline:

```sh
pnpm weather:fetch --years 2015 --months 1
pnpm weather:fetch
pnpm weather:build
pnpm weather:serve
```

Downloads cover 34°–72° N, 25° W–45° E at native 0.25° resolution. The uncompressed
temperature arrays alone are approximately 0.63 GB across the baseline; allow
additional space for downloaded NetCDF/ZIP files, temporary extraction and raster tiles. CDS queues may
take considerable time. There are 120 monthly requests, executed sequentially.
The downloader validates both direct NetCDF responses (observed for single-variable
requests) and zipped NetCDF responses. Completed downloads are reused only when the matching request record is present;
interrupted `.part` files are not treated as completed months.

The builder requires every non-leap baseline date exactly once, consistent grids,
Kelvin source units and a complete 150-sample window at each displayed cell.
Missing cells remain transparent rather than being filled with invented values.
It retains source SHA-256 checksums in `manifest.json`, plus a `NOTICE.txt`.
The manifest is written last, after every tile is built. Interrupted builds must
be rerun into a fresh output version directory; existing tiles are not overwritten.

Keep `pnpm weather:serve` running in one terminal and `pnpm dev` in another.
Open **Globe settings → Weather overlay → Daily temperature**. The controls
include an opacity slider and a Celsius colour legend. The app starts with the
overlay enabled, and reports missing metadata/tiles without breaking the base map.

Default atlas URL:

```text
http://127.0.0.1:8767/europe-temperature-v1
```

To change it, set `NEXT_PUBLIC_TEMPERATURE_TILE_URL` in `.env.local` and restart
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
