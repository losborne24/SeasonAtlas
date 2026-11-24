"""Public ARCO-ERA5 → 0.5° three-hourly samples → seasonal PNG atlas.

No cloud account, credentials, Zarr client, or provider processing job is needed.
Only the documented one-hour temperature chunks are fetched. Native chunks are
decoded and area-weighted onto a half-degree grid before being cached locally.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor, as_completed
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import time
import urllib.request

import numpy as np
from numcodecs import get_codec
from scipy.ndimage import convolve1d
from build import render_day, smooth, MONTH_STARTS, STOPS, COLORS
from install import install

BASE = 'https://storage.googleapis.com/gcp-public-data-arco-era5/ar/full_37-1h-0p25deg-chunk-1.zarr-v3'
HOURS = list(range(0, 24, 3))
ROOT = Path('.weather-data/arco')
NAME = 'global-temperature-2020-2024-3hour-05deg-128-v1'
LIMIT = 85.0511287798066
BOUNDS = [-180., -LIMIT, 180., LIMIT]

def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.next.json')
    if path.name == 'status.json': value = {**value, 'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)

def read_url(url):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                return response.read()
        except Exception:
            if attempt == 5: raise
            time.sleep(min(2 ** attempt, 30))

def decode(payload, metadata):
    if metadata['zarr_format'] != 2 or metadata.get('filters') or metadata['order'] != 'C':
        raise ValueError('Public store encoding changed; inspect before proceeding.')
    values = get_codec(metadata['compressor']).decode(payload)
    return np.frombuffer(values, dtype=metadata['dtype']).reshape(metadata['chunks'])

def half_degree(frame, latitude):
    """Area-weighted 0.5° cells, centred on every second native grid point.

    Trapezoid weights integrate the ±0.25° cell footprint. Longitude wraps;
    polar cells are clipped to the sphere. NaNs propagate, never become zeros.
    """
    weights = np.maximum(np.cos(np.radians(latitude)), 0.)[:, None]
    kernel = np.array([.25, .5, .25])
    weighted = convolve1d(frame.astype(np.float64) * weights, kernel, axis=0, mode='constant', cval=0)
    denominator = convolve1d(weights, kernel, axis=0, mode='constant', cval=0)
    weighted = convolve1d(weighted, kernel, axis=1, mode='wrap')
    result = (weighted / denominator)[::2, ::2]
    if result.shape != (361, 720) or not np.isfinite(result).all():
        raise ValueError('Missing or unexpected native temperature grid.')
    # Native coordinates are north→south and 0→359.75; render south→north, -180→179.5.
    return np.roll(result[::-1], 360, axis=1).astype(np.float32)

class PublicTemperature:
    def __init__(self):
        self.meta = json.loads(read_url(BASE + '/2m_temperature/.zarray'))
        attrs = json.loads(read_url(BASE + '/2m_temperature/.zattrs'))
        if self.meta['chunks'] != [1, 721, 1440] or attrs.get('units') != 'K':
            raise ValueError('Unexpected public temperature metadata.')
        self.latitude = self.coordinate('latitude')
        longitude = self.coordinate('longitude')
        if not np.array_equal(self.latitude, np.arange(90, -90.01, -.25)) or not np.array_equal(longitude, np.arange(0, 360, .25)):
            raise ValueError('Unexpected public coordinates.')
        self.time_meta = json.loads(read_url(BASE + '/time/.zarray'))
        time_attrs = json.loads(read_url(BASE + '/time/.zattrs'))
        if time_attrs.get('units') != 'hours since 1900-01-01 00:00:00':
            raise ValueError('Unexpected public timestamp encoding.')
        self.first_hour = int(decode(read_url(BASE + '/time/0'), self.time_meta)[0])
        self.time_chunks = {}
        self.start = np.datetime64('1900-01-01T00', 'h') + np.timedelta64(self.first_hour, 'h')
        atomic_json(ROOT / 'source-metadata.json', {'url': BASE, 'temperature': self.meta,
                    'firstTimestamp': str(self.start), 'latitude': [90, -90, -.25]})

    def coordinate(self, name):
        meta = json.loads(read_url(BASE + '/' + name + '/.zarray'))
        return decode(read_url(BASE + '/' + name + '/0'), meta)

    def fetch(self, day, hour):
        target = ROOT / 'samples' / str(day) / f'{hour:02}.npy'
        record = target.with_suffix('.json')
        if target.exists() and record.exists():
            saved = json.loads(record.read_text())
            if saved['cacheSha256'] != hashlib.sha256(target.read_bytes()).hexdigest():
                raise ValueError(f'Cached sample checksum failed: {target}')
            return {**saved, 'reused': True}
        stamp = np.datetime64(f'{day}T{hour:02}', 'h')
        index = int((stamp - self.start) / np.timedelta64(1, 'h'))
        if index < 0 or index >= self.meta['shape'][0]: raise ValueError('Timestamp outside store.')
        # Validate time coordinates at each requested index, including across chunk boundaries.
        time_chunk = index // self.time_meta['chunks'][0]
        if time_chunk not in self.time_chunks:
            self.time_chunks[time_chunk] = decode(read_url(BASE + f'/time/{time_chunk}'), self.time_meta)
        times = self.time_chunks[time_chunk]
        expected = int((stamp - np.datetime64('1900-01-01T00', 'h')) / np.timedelta64(1, 'h'))
        if int(times[index % self.time_meta['chunks'][0]]) != expected:
            raise ValueError('Public time index does not match the requested timestamp.')
        started = time.monotonic()
        payload = read_url(BASE + f'/2m_temperature/{index}.0.0')
        values = decode(payload, self.meta)[0]
        if not np.isfinite(values).all() or values.min() < 150 or values.max() > 360:
            raise ValueError('Invalid Kelvin temperatures.')
        coarse = half_degree(values, self.latitude) - np.float32(273.15)
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix('.part')
        with temporary.open('wb') as stream: np.save(stream, coarse)
        temporary.replace(target)
        saved = {'date': str(day), 'hourUTC': hour, 'sourceUrl': BASE + f'/2m_temperature/{index}.0.0',
                 'sourceSha256': hashlib.sha256(payload).hexdigest(), 'sourceBytes': len(payload),
                 'cacheSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                 'seconds': round(time.monotonic() - started, 3)}
        atomic_json(record, saved)
        return saved

def dates(start, end):
    while start <= end:
        if (start.month, start.day) != (2, 29): yield start
        start += timedelta(days=1)

def fetch_dates(days, workers=4):
    source = PublicTemperature()
    jobs = [(day, hour) for day in days for hour in HOURS]
    done = 0
    source_bytes = 0
    reused = network_bytes = 0
    started = time.monotonic()
    # Bound pending futures as well as active requests, one calendar month at a time.
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for offset in range(0, len(jobs), 248):
            futures = [pool.submit(source.fetch, *job) for job in jobs[offset:offset + 248]]
            for future in as_completed(futures):
                result = future.result()
                done += 1
                source_bytes += result['sourceBytes']
                if result.get('reused'): reused += 1
                else: network_bytes += result['sourceBytes']
                if done % 8 == 0 or done == len(jobs):
                    status = {'stage': 'downloading', 'completedFrames': done, 'totalFrames': len(jobs),
                              'sourceBytes': source_bytes, 'networkBytesThisRun': network_bytes,
                              'reusedFrames': reused, 'elapsedSeconds': round(time.monotonic() - started),
                              'latest': f"{result['date']}T{result['hourUTC']:02}:00Z"}
                    atomic_json(ROOT / 'status.json', status)
                    print(json.dumps(status), flush=True)
    return source_bytes

def manifest(kind, days, sample_date=None):
    result = {'version': 1, 'kind': kind, 'variable': 'temperature_2m', 'baseline': [2020, 2024],
              'windowDays': 15, 'statistic': 'hourly_mean', 'timezone': 'UTC', 'hours': HOURS,
              'bounds': BOUNDS, 'resolutionDegrees': .5, 'minzoom': 0, 'maxzoom': 3,
              'tileSize': 128, 'format': 'png', 'days': days,
              'spatialMethod': 'cosine-weighted trapezoid average over 0.5-degree cells',
              'colors': [{'value': float(v), 'color': '#%02x%02x%02x' % tuple(c.astype(int))} for v, c in zip(STOPS, COLORS)],
              'source': 'https://github.com/google-research/arco-era5', 'sourceStore': BASE}
    if sample_date:
        result.update(sampleDate=sample_date, statistic='instantaneous', windowDays=1)
    return result

def tile_job(arguments):
    file, hour, day, output = arguments
    frame = np.load(file, mmap_mode='r')
    if frame.ndim == 3: frame = frame[day - 1]
    render_day(frame, np.arange(-90, 90.01, .5), np.arange(-180, 180, .5), BOUNDS,
               Path(output) / f'{hour:02}', 3, day, size=128)

def validate_tiles(output, days):
    from PIL import Image
    expected = len(days) * 8 * 85
    files = list(output.rglob('*.png'))
    if len(files) != expected: raise ValueError(f'Expected {expected} tiles, got {len(files)}')
    for file in files:
        with Image.open(file) as image:
            image.load()
            if image.size != (128, 128) or image.mode != 'RGBA' or image.getextrema()[3] != (255, 255):
                raise ValueError(f'Invalid/transparent global tile: {file}')
    return sum(f.stat().st_size for f in files)

def trial():
    sample = date(2020, 7, 15)
    started = time.monotonic()
    transferred = fetch_dates([sample])
    download_seconds = time.monotonic() - started
    output = Path('.weather-data/tiles/global-temperature-hourly-trial-128-v1')
    output.mkdir(parents=True, exist_ok=True)
    args = [(ROOT / 'samples' / str(sample) / f'{h:02}.npy', h, 196, output) for h in HOURS]
    with ProcessPoolExecutor(max_workers=4) as pool: list(pool.map(tile_job, args))
    size = validate_tiles(output, [196])
    metadata = manifest('sample', [196], str(sample))
    atomic_json(output / 'manifest.json', metadata)
    report = {'date': str(sample), 'sourceBytes': transferred, 'downloadSeconds': round(download_seconds, 2),
              'totalSeconds': round(time.monotonic() - started, 2), 'tileBytes': size, 'tileCount': 680,
              'estimated365DayTileBytes': size * 365, 'estimated5YearSourceBytes': transferred * 1825}
    report['reusedFrames'] = json.loads((ROOT / 'status.json').read_text())['reusedFrames']
    atomic_json(ROOT / 'trial-report.json', report)
    print(json.dumps(report), flush=True)

def seasonal_hour(hour, output, workers):
    work = ROOT / 'work'
    work.mkdir(parents=True, exist_ok=True)
    destination = work / f'frames-{hour:02}.npy'
    checkpoint = work / f'frames-{hour:02}.json'
    if not checkpoint.exists():
        sums = np.zeros((365, 361, 720), dtype=np.float64)
        counts = np.zeros(sums.shape, dtype=np.uint16)
        for day in dates(date(2020, 1, 1), date(2024, 12, 31)):
            index = MONTH_STARTS[day.month - 1] + day.day - 2
            values = np.load(ROOT / 'samples' / str(day) / f'{hour:02}.npy')
            if values.shape != (361, 720) or not np.isfinite(values).all(): raise ValueError('Incomplete cache.')
            sums[index] += values
            counts[index] += 1
        frames = np.lib.format.open_memmap(destination, mode='w+', dtype=np.float32, shape=sums.shape)
        for row in range(0, 361, 16):
            frames[:, row:row + 16] = smooth(sums[:, row:row + 16], counts[:, row:row + 16], year_count=5)[0]
        frames.flush()
        if not np.isfinite(frames).all(): raise ValueError('Missing baseline samples.')
        # Independent raw-cache check at July 15, Paris and the cyclic January window.
        for target in [1, 196]:
            for row, col in [(278, 365), (90, 0), (360, 719)]:
                values = []
                for year in range(2020, 2025):
                    for offset in range(-7, 8):
                        index = (target - 1 + offset) % 365
                        calendar_day = date(2001, 1, 1) + timedelta(days=index)
                        raw_day = date(year, calendar_day.month, calendar_day.day)
                        values.append(float(np.load(ROOT / 'samples' / str(raw_day) / f'{hour:02}.npy', mmap_mode='r')[row, col]))
                if abs(float(frames[target - 1, row, col]) - np.mean(values)) > 1e-4:
                    raise ValueError('Independent seasonal reference does not match.')
        atomic_json(checkpoint, {'hourUTC': hour, 'days': 365, 'samplesPerCell': 75})
        del sums, counts, frames
    # An interrupted day has fewer than 85 files and is safely rendered again.
    jobs = [(destination, hour, d, output) for d in range(1, 366)
            if len(list((output / f'{hour:02}' / str(d)).rglob('*.png'))) != 85]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for number, _ in enumerate(pool.map(tile_job, jobs), 1):
            if number % 30 == 0: print(f'Tiled hour {hour:02}: {number}/{len(jobs)} days', flush=True)

def world(workers=4):
    import fcntl
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / 'world.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fetch_dates(list(dates(date(2020, 1, 1), date(2024, 12, 31))), workers)
        output = Path('.weather-data/tiles') / NAME
        output.mkdir(parents=True, exist_ok=True)
        for hour in HOURS:
            atomic_json(ROOT / 'status.json', {'stage': 'building', 'hourUTC': hour})
            seasonal_hour(hour, output, workers)
        atomic_json(ROOT / 'status.json', {'stage': 'validating'})
        size = validate_tiles(output, list(range(1, 366)))
        metadata = manifest('era5', list(range(1, 366)))
        records = sorted((ROOT / 'samples').glob('*/*.json'))
        if len(records) != 365 * 5 * 8: raise ValueError('Incomplete source provenance.')
        metadata['sourceSha256'] = {str(p.relative_to(ROOT)): json.loads(p.read_text())['sourceSha256'] for p in records}
        atomic_json(output / 'manifest.json', metadata)
        (output / 'NOTICE.txt').write_text('Modified Copernicus ERA5 information via Google Research ARCO-ERA5, CC BY 4.0.\n'
            '2020–2024, same UTC hour across selected date ±7 days; 75 samples per cell.\n'
            '0.5° area-weighted spatial average; February 29 excluded. Raster interpolation adds no weather detail.\n')
        from annual import build_annual
        build_annual()
        install(output)
        atomic_json(ROOT / 'status.json', {'stage': 'ready', 'tileBytes': size, 'tileBase': '/weather/' + NAME})

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['trial', 'world'])
    parser.add_argument('--workers', type=int, choices=range(1, 9), default=4)
    args = parser.parse_args()
    try:
        if args.mode == 'trial': trial()
        else: world(args.workers)
    except Exception as error:
        atomic_json(ROOT / 'status.json', {'stage': 'failed', 'error': str(error)})
        raise
