"""Build a yearless, selected-baseline ±7-day ERA5 daily-mean temperature atlas locally."""
import argparse
import hashlib
import json
import math
from concurrent.futures import ProcessPoolExecutor, as_completed
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import xarray as xr
from PIL import Image
from scipy.ndimage import map_coordinates

START_YEAR, END_YEAR, RADIUS = 2015, 2024, 7
MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
# Stable physical scale, shared with the map legend. Outliers clamp at endpoints.
STOPS = np.array([-30, -15, 0, 10, 20, 30, 45], dtype=float)
COLORS = np.array([[74, 66, 155], [91, 136, 218], [112, 207, 232], [110, 206, 156],
                   [247, 220, 111], [240, 141, 68], [194, 59, 51]], dtype=float)

def smooth(sums, counts, radius=RADIUS, year_count=END_YEAR - START_YEAR + 1):
    total = sum(np.roll(sums, offset, axis=0) for offset in range(-radius, radius + 1))
    count = sum(np.roll(counts, offset, axis=0) for offset in range(-radius, radius + 1))
    result = np.full(total.shape, np.nan, dtype=np.float32)
    # A displayed cell must have every selected year × the full daily window.
    np.divide(total, count, out=result, where=count == year_count * (2 * radius + 1))
    return result, count

def input_files(root, scratch):
    for file in sorted(root.glob('*')):
        if file.suffix == '.nc':
            yield file, file
        elif file.suffix == '.zip':
            with zipfile.ZipFile(file) as archive:
                for index, name in enumerate(archive.namelist()):
                    if name.endswith('.nc'):
                        # Do not extract archive paths onto the filesystem.
                        output = scratch / f'{file.stem}-{index}.nc'
                        with archive.open(name) as source, output.open('wb') as target:
                            import shutil
                            shutil.copyfileobj(source, target)
                        yield output, file
                        output.unlink()

def aggregate(root, fixture=False, workspace=None, start_year=START_YEAR, end_year=END_YEAR):
    sums = counts = lat = lon = None
    seen = set()
    sources = {}
    with tempfile.TemporaryDirectory(prefix='seasonatlas-era5-') as temp:
        for file, original in input_files(root, Path(temp)):
            with xr.open_dataset(file) as ds:
                name = next((n for n in ['t2m', '2m_temperature', 'mean_2m_temperature'] if n in ds), None)
                if name is None:
                    raise ValueError(f'No 2 m temperature in {original.name}')
                data = ds[name].squeeze(drop=True)
                rename = {n: v for n, v in [('valid_time', 'time'), ('latitude', 'lat'), ('longitude', 'lon')] if n in data.dims}
                data = data.rename(rename).transpose('time', 'lat', 'lon').sortby('lat')
                data = data.assign_coords(lon=((data.lon + 180) % 360) - 180).sortby('lon')
                if str(data.attrs.get('units', '')).lower() not in ['k', 'kelvin']:
                    raise ValueError('CDS source temperature must be in Kelvin.')
                if not fixture and ds.attrs.get('seasonatlas_fixture'):
                    raise ValueError('Synthetic input requires --fixture; it cannot become a real atlas.')
                dates = data.time.values.astype('datetime64[D]')
                years = dates.astype('datetime64[Y]').astype(int) + 1970
                if not np.any((years >= start_year) & (years <= end_year)):
                    continue
                if original.name not in sources:
                    digest = hashlib.sha256()
                    with original.open('rb') as stream:
                        for block in iter(lambda: stream.read(1024 * 1024), b''):
                            digest.update(block)
                    sources[original.name] = digest.hexdigest()
                current_lat, current_lon = data.lat.values, data.lon.values
                if lat is None:
                    lat, lon = current_lat, current_lon
                    for coord in [lat, lon]:
                        if len(coord) < 2 or not np.isfinite(coord).all() or not np.allclose(np.diff(coord), np.diff(coord)[0]) or np.diff(coord)[0] <= 0:
                            raise ValueError('Expected regular increasing latitude/longitude axes.')
                        if not fixture and not np.allclose(np.diff(coord), 0.25):
                            raise ValueError('Production input must retain the native 0.25° ERA5 grid.')
                    shape = (365, len(lat), len(lon))
                    if workspace is None:
                        sums = np.zeros(shape, dtype=np.float64)
                        counts = np.zeros(shape, dtype=np.uint16)
                    else:
                        workspace.mkdir(parents=True, exist_ok=True)
                        sums = np.lib.format.open_memmap(workspace / 'sums.npy', mode='w+', dtype=np.float64, shape=shape)
                        counts = np.lib.format.open_memmap(workspace / 'counts.npy', mode='w+', dtype=np.uint16, shape=shape)
                        sums[:] = 0; counts[:] = 0
                elif not np.array_equal(lat, current_lat) or not np.array_equal(lon, current_lon):
                    raise ValueError('Source grids differ; refusing to mix coordinates.')
                dates = data.time.values.astype('datetime64[D]')
                if len(np.unique(dates)) != len(dates):
                    raise ValueError('Expected one daily mean per UTC date, not hourly records.')
                for i, date in enumerate(dates):
                    text = str(date)
                    year, month, day = map(int, text.split('-'))
                    if not start_year <= year <= end_year:
                        continue
                    if text in seen:
                        raise ValueError(f'Duplicate UTC date: {text}')
                    seen.add(text)
                    if month == 2 and day == 29:
                        continue
                    index = MONTH_STARTS[month - 1] + day - 2
                    frame = data.isel(time=i).values.astype(np.float64) - 273.15
                    valid = np.isfinite(frame)
                    if np.any((frame[valid] < -120) | (frame[valid] > 80)):
                        raise ValueError('Implausible temperature; check input units.')
                    sums[index] += np.where(valid, frame, 0)
                    counts[index] += valid
                print(f'Aggregated {original.name}', flush=True)
    expected = {str(d) for d in np.arange(np.datetime64(f'{start_year}-01-01'), np.datetime64(f'{end_year + 1}-01-01')) if not str(d).endswith('02-29')}
    if seen - expected and any(not d.endswith('02-29') for d in seen - expected):
        raise ValueError('Unexpected source dates.')
    if not expected.issubset(seen):
        raise ValueError(f'Missing {len(expected - seen)} baseline dates; download all {(end_year - start_year + 1) * 12} selected months before building.')
    if sums is None:
        raise ValueError('No NetCDF inputs found.')
    if workspace is None:
        frames = smooth(sums, counts, year_count=end_year - start_year + 1)[0]
    else:
        sums.flush(); counts.flush()
        frames = np.lib.format.open_memmap(workspace / 'frames.npy', mode='w+', dtype=np.float32, shape=sums.shape)
        for row in range(0, len(lat), 16):
            end = min(row + 16, len(lat))
            frames[:, row:end] = smooth(sums[:, row:end], counts[:, row:end], year_count=end_year - start_year + 1)[0]
            print(f'Smoothed latitude rows {row}–{end}/{len(lat)}', flush=True)
        frames.flush()
    return frames, lat, lon, sources

def tile_range(bounds, z):
    west, south, east, north = bounds
    n = 2 ** z
    def y(lat):
        return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    for x in range(max(0, math.floor((west + 180) / 360 * n)), min(n, math.ceil((east + 180) / 360 * n))):
        for ty in range(max(0, math.floor(y(north))), min(n, math.ceil(y(south)))):
            yield x, ty

def sample_frame(frame, lat, lon, z, x, y, size=256):
    n = 2 ** z
    longs = ((x + (np.arange(size) + .5) / size) / n) * 360 - 180
    lats = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * (y + (np.arange(size) + .5) / size) / n))))
    xx, yy = np.meshgrid((longs - lon[0]) / (lon[1] - lon[0]), (lats - lat[0]) / (lat[1] - lat[0]))
    periodic = np.isclose((lon[1] - lon[0]) * len(lon), 360)
    # The global latitude grid extends to ±90, so only longitude wraps here.
    return map_coordinates(frame, [yy, xx], order=1, mode='grid-wrap' if periodic else 'constant', cval=np.nan, prefilter=False)

def rgba(values):
    out = np.zeros((*values.shape, 4), dtype=np.uint8)
    valid = np.isfinite(values)
    for channel in range(3):
        out[..., channel][valid] = np.interp(values[valid], STOPS, COLORS[:, channel]).round().astype(np.uint8)
    out[..., 3][valid] = 255
    return out

def render_day(frame, lat, lon, bounds, output, maxzoom, day, size=256):
    for z in range(maxzoom + 1):
        for x, y in tile_range(bounds, z):
            target = output / str(day) / str(z) / str(x) / f'{y}.png'
            target.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(rgba(sample_frame(frame, lat, lon, z, x, y, size))).save(target, compress_level=6)

def init_worker(file, lat, lon, bounds, output, maxzoom):
    global WORKER
    WORKER = (np.load(file, mmap_mode='r'), lat, lon, bounds, Path(output), maxzoom)

def render_worker(day):
    frames, lat, lon, bounds, output, maxzoom = WORKER
    render_day(frames[day - 1], lat, lon, bounds, output, maxzoom, day)
    return day

def build(raw, output, maxzoom=4, days=None, fixture=False, workspace=None, workers=1, start_year=START_YEAR, end_year=END_YEAR):
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output already contains files. Use a new version directory to avoid stale tiles.')
    frames, lat, lon, sources = aggregate(raw, fixture, workspace, start_year, end_year)
    if not any(np.isfinite(frames[day]).any() for day in range(365)):
        raise ValueError('No cells have the full baseline coverage; refusing an empty atlas.')
    days = list(range(1, 366)) if days is None else sorted(set(days))
    if not days or any(d < 1 or d > 365 for d in days):
        raise ValueError('Days must be in 1–365.')
    if not fixture and days != list(range(1, 366)):
        raise ValueError('Production atlas requires all 365 frames; --days is for fixture tests only.')
    global_grid = np.isclose((lon[1] - lon[0]) * len(lon), 360)
    limit = 85.0511287798066
    bounds = [-180.0, -limit, 180.0, limit] if global_grid else [float(lon[0]), float(lat[0]), float(lon[-1]), float(lat[-1])]
    output.mkdir(parents=True, exist_ok=True)
    if workers > 1 and workspace is not None:
        with ProcessPoolExecutor(max_workers=workers, initializer=init_worker,
                                 initargs=(str(workspace / 'frames.npy'), lat, lon, bounds, str(output), maxzoom)) as pool:
            futures = [pool.submit(render_worker, day) for day in days]
            for count, future in enumerate(as_completed(futures), 1):
                day = future.result()
                print(f'Tiled day {day}; {count}/{len(days)} complete', flush=True)
    else:
        for day in days:
            render_day(frames[day - 1], lat, lon, bounds, output, maxzoom, day)
            print(f'Tiled day {day}/365', flush=True)
    manifest = {
        'version': 1, 'kind': 'test' if fixture else 'era5', 'variable': 'temperature_2m',
        'baseline': [start_year, end_year], 'windowDays': 15, 'statistic': 'daily_mean', 'timezone': 'UTC',
        'bounds': bounds, 'resolutionDegrees': float(lon[1] - lon[0]), 'minzoom': 0, 'maxzoom': maxzoom,
        'tileSize': 256, 'format': 'png', 'days': days,
        'colors': [{'value': float(v), 'color': '#%02x%02x%02x' % tuple(c.astype(int))} for v, c in zip(STOPS, COLORS)],
        'source': 'https://cds.climate.copernicus.eu/datasets/derived-era5-single-levels-daily-statistics',
        'sourceSha256': sources,
    }
    (output / 'NOTICE.txt').write_text(('SYNTHETIC TEST DATA — NOT WEATHER\n' if fixture else '') +
        f'Derived from Copernicus ERA5 via CDS, CC BY 4.0.\n{start_year}–{end_year}; 24-hour UTC daily mean, then ±7-day mean across years.\n'
        'Kelvin converted to Celsius; February 29 excluded. Missing cells remain transparent.\n'
        'Raster pixels use bilinear interpolation; model resolution does not increase with map zoom.\n')
    # Publish last: a failed/interrupted build never advertises a complete atlas.
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, default=Path('.weather-data/raw'))
    parser.add_argument('--output', type=Path, default=Path('.weather-data/tiles/europe-temperature-v1'))
    parser.add_argument('--maxzoom', type=int, choices=range(0, 6), default=4)
    parser.add_argument('--start-year', type=int)
    parser.add_argument('--end-year', type=int, default=2024)
    parser.add_argument('--global', dest='world', action='store_true')
    parser.add_argument('--workers', type=int, choices=range(1, 9), default=4)
    parser.add_argument('--fixture', action='store_true', help='Mark all output SYNTHETIC TEST DATA')
    parser.add_argument('--days', type=int, nargs='+', help='Subset only when --fixture is set')
    args = parser.parse_args()
    if args.world:
        if args.raw == Path('.weather-data/raw'): args.raw = Path('.weather-data/raw-global')
        if args.output == Path('.weather-data/tiles/europe-temperature-v1'): args.output = Path(f'.weather-data/tiles/global-temperature-{args.start_year or 2020}-{args.end_year}-v1')
    workspace = Path('.weather-data/work') / args.output.name if args.world else None
    start_year = args.start_year if args.start_year is not None else 2020
    if not 2015 <= start_year <= args.end_year <= 2024:
        parser.error('Choose a baseline within 2015–2024.')
    build(args.raw, args.output, args.maxzoom, args.days, args.fixture, workspace, args.workers, start_year, args.end_year)
