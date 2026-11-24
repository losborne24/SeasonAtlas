# Temperature tiles on Cloudflare Pages Free

Keep the Next.js app on Vercel and publish the generated weather data as a
separate, purely static Pages project. No R2 bucket, Functions, Workers script,
or paid Cloudflare plan is needed for this tile project.

Pages Free accepts 20,000 files per project, up to 25 MiB each. Static requests
are free and unlimited. The original worldwide atlas has 248,200 PNGs; the
packager combines each day/hour frame into one binary file without changing
any PNG pixels, weather values, zoom levels, resolution or attribution.

## Package the existing atlas

From the repository root:

```sh
pnpm weather:pages --source public/weather/global-temperature-2020-2024-3hour-05deg-128-v1
```

This needs Python 3 only, with no additional packages. It reads existing local
data and writes `.weather-data/pages-temperature/`. If the source is still in
`.weather-data/tiles/`, use that complete atlas directory instead. Do not use
the root `public/weather/` manifest: that is a pointer to the installed atlas.

The output contains 2,920 frame bundles, a manifest, attribution, CORS/cache
headers, a landing page, a real 404 page, and a packaging report: 2,926 files in
total. For the current atlas, bundles occupy 2,257,604,948 bytes (2.26 GB) and
the largest is 819,772 bytes (0.78 MiB). Generated output stays Git-ignored.

The command rejects incomplete frames, invalid PNG headers/dimensions, oversized
files, excessive file counts and existing output directories. For another build,
choose a fresh `--output .weather-data/pages-temperature-v2`. A content-derived
`frames-<hash>` directory gives bundles immutable URLs; publish the entire output
folder together. Changing the PNG payload changes that directory's name.

## Verify before upload

```sh
pnpm weather:pages:check .weather-data/pages-temperature public/weather/global-temperature-2020-2024-3hour-05deg-128-v1
pnpm typecheck
pnpm lint
```

The pack checks run a temporary local HTTP server. They exercise bundle loading,
shared requests, cancellation, retries, cache eviction and malformed data. With
the two directory arguments above, they decode every generated frame and compare
every tile on January 1, July 15 and December 31 at all eight UTC hours against
the original PNG bytes. Run without arguments for the standalone fixture checks.

## Upload the data with Wrangler

Use Wrangler rather than dashboard drag and drop: the dashboard accepts only
1,000 files, while Wrangler supports the Free plan's 20,000-file limit.

```sh
pnpm dlx wrangler@4 login
pnpm dlx wrangler@4 pages project create seasonatlas-temperature --production-branch main
pnpm dlx wrangler@4 pages deploy .weather-data/pages-temperature --project-name seasonatlas-temperature --branch main
```

Use your chosen project name if `seasonatlas-temperature` is unavailable.
These commands log in and publish; packaging and validation never do either.
The data project has no framework, install step or build command: its upload
directory is already the complete site. Upload the folder's contents as-is,
including `_headers` and `404.html`.

## Connect the Vercel app

Set this environment variable in the Vercel environments you use, substituting
the actual Pages hostname printed by Wrangler:

```dotenv
NEXT_PUBLIC_TEMPERATURE_TILE_URL=https://seasonatlas-temperature.pages.dev
```

Redeploy the updated app. This variable is embedded at build time. Do not add
`/manifest.json` to it. The loader resolves the manifest's relative frame path
on the Pages host; the old local `/weather/...` path is replaced when packaging.
The existing PNG-based local setup still works when the variable is unset.

After uploading, check these URLs:

- `/manifest.json`: JSON containing `tileStorage: "frame-pack-v1"` and a relative
  `tileBase` beginning `./frames-`.
- `/<frames-directory>/00/1.satpack`: HTTP 200 and
  `Access-Control-Allow-Origin: *`, with long-lived immutable caching.
- `/missing.satpack`: HTTP 404, without an SPA fallback.

Open the Vercel app, change day and hour, pan/zoom, and check the temperature
overlay. Network requests should go to the Pages domain and share one bundle
per selected frame. Each bundle currently downloads about 0.8 MB even when
zoomed into one region; the browser retains at most four completed bundles
within a 32 MiB cache. Obsolete downloads abort when no visible tile needs them.
Failed bundles remain retryable and the existing frame stays displayed on error.

This publishes the **raster temperature overlay**. The annual-chart API still
reads its separate monthly `.bin` dataset from the app's local filesystem, and
the point-weather API still calls its existing provider. Neither is configured
by `NEXT_PUBLIC_TEMPERATURE_TILE_URL`.

## Bundle format

`SAT1` magic (four bytes), little-endian uint32 tile count, then uint32 absolute
offset/length pairs. PNGs follow unchanged, ordered by zoom, y, x. A tile's index
is `(4^z - 1) / 3 + y * 2^z + x`. Daily paths are `<day>.satpack`; hourly paths
are `<HH>/<day>.satpack`. Bundles download whole, so no byte-range support or
dynamic server is required. PNG protocol URLs remain supported for local atlases.

Official references: [Pages limits](https://developers.cloudflare.com/pages/platform/limits/),
[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/),
[static request pricing](https://developers.cloudflare.com/pages/functions/pricing/),
[response headers](https://developers.cloudflare.com/pages/configuration/headers/).
