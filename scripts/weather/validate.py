"""Verify generated real ERA5 tiles, source checksums and independent reference pixels."""
import argparse
from contextlib import contextmanager
import tempfile
import zipfile
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import xarray as xr
from PIL import Image
from build import tile_range

@contextmanager
def source_dataset(root, year, month):
    stem = root / f'era5-daily-{year}-{month:02}'
    if stem.with_suffix('.nc').exists():
        with xr.open_dataset(stem.with_suffix('.nc')) as dataset:
            yield dataset
    else:
        with tempfile.TemporaryDirectory(prefix='seasonatlas-reference-') as temporary:
            with zipfile.ZipFile(stem.with_suffix('.zip')) as archive:
                names = [name for name in archive.namelist() if name.endswith('.nc')]
                if len(names) != 1:
                    raise ValueError('Expected one temperature NetCDF in the archive.')
                file = Path(temporary) / 'temperature.nc'
                file.write_bytes(archive.read(names[0]))
            with xr.open_dataset(file) as dataset:
                yield dataset

def reference_pixel(root, output, manifest, day, months, predicate):
    z = manifest['maxzoom']
    n = 2 ** z
    xglobal = (2.3522 + 180) / 360 * n
    yglobal = (1 - math.asinh(math.tan(math.radians(48.8566))) / math.pi) / 2 * n
    x, y = math.floor(xglobal), math.floor(yglobal)
    px, py = math.floor((xglobal - x) * 256), math.floor((yglobal - y) * 256)
    lon = (x + (px + .5) / 256) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + (py + .5) / 256) / n))))
    west, south = math.floor(lon * 4) / 4, math.floor(lat * 4) / 4
    series = []
    for year in range(2015, 2025):
        for month in months:
            with source_dataset(root, year, month) as dataset:
                data = dataset['t2m']
                time = next(dim for dim in data.dims if dim in ['time', 'valid_time'])
                dates = data[time].values.astype('datetime64[D]')
                select = [i for i, date in enumerate(dates) if predicate(str(date))]
                if select:
                    block = data.isel({time: select}).sel(latitude=[south, south + .25], longitude=[west, west + .25])
                    series.extend(block.transpose(time, 'latitude', 'longitude').values.astype(float) - 273.15)
    assert len(series) == 150, f'Expected 150 source days, found {len(series)}'
    cells = np.mean(series, axis=0)
    wx, wy = (lon - west) / .25, (lat - south) / .25
    temperature = (cells[0, 0] * (1 - wx) * (1 - wy) + cells[0, 1] * wx * (1 - wy) +
                   cells[1, 0] * (1 - wx) * wy + cells[1, 1] * wx * wy)
    stops = [stop['value'] for stop in manifest['colors']]
    rgb = np.array([[int(stop['color'][i:i+2], 16) for i in [1, 3, 5]] for stop in manifest['colors']])
    expected = np.array([round(np.interp(temperature, stops, rgb[:, i])) for i in range(3)] + [255])
    with Image.open(output / str(day) / str(z) / str(x) / f'{y}.png') as image:
        actual = np.array(image.getpixel((px, py)))
    assert np.max(np.abs(actual - expected)) <= 1, f'Pixel mismatch: {actual} vs {expected}'
    print(f'Day {day}: Paris-area pixel matches 150 raw daily records ({temperature:.3f} °C).')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw', type=Path, default=Path('.weather-data/raw'))
    parser.add_argument('--directory', type=Path, default=Path('.weather-data/tiles/europe-temperature-v1'))
    args = parser.parse_args()
    manifest = json.loads((args.directory / 'manifest.json').read_text())
    assert manifest['kind'] == 'era5' and manifest['baseline'] == [2015, 2024]
    assert manifest['windowDays'] == 15 and manifest['timezone'] == 'UTC'
    assert manifest['days'] == list(range(1, 366))
    assert len(manifest['sourceSha256']) == 120
    for name, expected in manifest['sourceSha256'].items():
        digest = hashlib.sha256()
        with (args.raw / name).open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        assert digest.hexdigest() == expected, f'Source changed: {name}'
    count = 0
    for day in manifest['days']:
        for z in range(manifest['maxzoom'] + 1):
            for x, y in tile_range(manifest['bounds'], z):
                with Image.open(args.directory / str(day) / str(z) / str(x) / f'{y}.png') as image:
                    image.load()
                    assert image.size == (256, 256) and image.mode == 'RGBA'
                count += 1
    reference_pixel(args.raw, args.directory, manifest, 196, [7], lambda date: 8 <= int(date[-2:]) <= 22)
    reference_pixel(args.raw, args.directory, manifest, 1, [1, 12], lambda date: (date[5:7] == '01' and int(date[-2:]) <= 8) or (date[5:7] == '12' and int(date[-2:]) >= 25))
    print(f'Validated all {count} tiles, 365 days and 120 unchanged source files.')

if __name__ == '__main__':
    main()
