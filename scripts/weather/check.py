"""Deterministic data/math/tile checks. Synthetic data stays in a temporary directory."""
import contextlib
import io
import json
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import xarray as xr
from PIL import Image
from build import aggregate, build, rgba, sample_frame, smooth, STOPS, COLORS
from fetch import download_format, request_for

def run():
    values = np.ones((365, 2, 2), dtype=np.float64) * 20
    counts = np.ones(values.shape, dtype=np.uint16) * 10
    averaged, coverage = smooth(values * 10, counts)
    np.testing.assert_allclose(averaged, 20)
    assert (coverage == 150).all()
    five_counts = np.ones(values.shape, dtype=np.uint16) * 5
    five_mean, five_coverage = smooth(values * five_counts, five_counts, year_count=5)
    np.testing.assert_allclose(five_mean, 20)
    assert (five_coverage == 75).all()
    counts[364, 0, 0] = 9
    incomplete, _ = smooth(values * counts, counts)
    assert np.isnan(incomplete[0, 0, 0])  # December wraps into January.
    assert np.isfinite(incomplete[20, 0, 0])
    palette = rgba(np.array([[np.nan, -100, 100, 0]]))
    assert palette[0, 0, 3] == 0
    np.testing.assert_array_equal(palette[0, 1, :3], COLORS[0])
    np.testing.assert_array_equal(palette[0, 2, :3], COLORS[-1])
    np.testing.assert_array_equal(palette[0, 3, :3], COLORS[list(STOPS).index(0)])
    request = request_for(2020, 2)
    assert len(request['day']) == 29 and request['frequency'] == '1_hourly'
    assert request['daily_statistic'] == 'daily_mean' and request['time_zone'] == 'utc+00:00'
    with tempfile.TemporaryDirectory(prefix='seasonatlas-weather-check-') as temporary:
        root = Path(temporary)
        raw = root / 'raw'
        raw.mkdir()
        dates = np.arange(np.datetime64('2015-01-01'), np.datetime64('2025-01-01'))
        lat, lon = np.linspace(34, 72, 9), np.linspace(-25, 45, 9)
        # Spatially linear Kelvin field; independent expected interpolation values are known.
        field = 273.15 + 5 + .2 * lat[:, None] + .1 * lon[None, :]
        frames = np.broadcast_to(field, (len(dates), len(lat), len(lon))).copy()
        frames[np.array([str(date).endswith('02-29') for date in dates])] = 300  # Must be excluded.
        data = xr.Dataset({'t2m': (('valid_time', 'latitude', 'longitude'), frames)},
                          coords={'valid_time': dates.astype('datetime64[ns]'), 'latitude': lat, 'longitude': lon},
                          attrs={'seasonatlas_fixture': 1})
        data.t2m.attrs['units'] = 'K'
        data.to_netcdf(raw / 'fixture.nc')
        assert download_format(raw / 'fixture.nc') == '.nc'
        with zipfile.ZipFile(root / 'fixture.zip', 'w') as archive:
            archive.write(raw / 'fixture.nc', 'temperature.nc')
        assert download_format(root / 'fixture.zip') == '.zip'
        with contextlib.redirect_stdout(io.StringIO()):
            climate, actual_lat, actual_lon, _ = aggregate(raw, fixture=True)
            chunked, _, _, _ = aggregate(raw, fixture=True, workspace=root / 'work')
            manifest = build(raw, root / 'tiles', maxzoom=2, days=[1, 196], fixture=True)
        np.testing.assert_allclose(chunked, climate, atol=1e-6)
        np.testing.assert_allclose(climate[0], field - 273.15, atol=1e-5)
        np.testing.assert_allclose(climate[195], field - 273.15, atol=1e-5)
        five_raw = root / 'five-raw'
        five_raw.mkdir()
        five_data = data.copy(deep=True)
        old = dates.astype('datetime64[Y]').astype(int) + 1970 < 2020
        five_data['t2m'].values[old] += 40
        five_data.to_netcdf(five_raw / 'fixture.nc')
        with contextlib.redirect_stdout(io.StringIO()):
            five, _, _, _ = aggregate(five_raw, fixture=True, start_year=2020, end_year=2024)
            five_manifest = build(five_raw, root / 'five-tiles', maxzoom=0, days=[196], fixture=True, start_year=2020, end_year=2024)
        np.testing.assert_allclose(five[195], field - 273.15, atol=1e-5)
        assert five_manifest['baseline'] == [2020, 2024]
        sample = sample_frame(climate[195], actual_lat, actual_lon, 2, 2, 1)
        n = 4
        longs = (2 + (np.arange(256) + .5) / 256) / n * 360 - 180
        lats = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (1 + (np.arange(256) + .5) / 256) / n))))
        expected = 5 + .2 * lats[:, None] + .1 * longs[None, :]
        valid = np.isfinite(sample)
        assert valid.any()
        np.testing.assert_allclose(sample[valid], expected[valid], atol=1e-5)
        assert manifest['kind'] == 'test' and manifest['days'] == [1, 196]
        world_lat = np.array([-90., 0., 90.])
        world_lon = np.array([-180., -90., 0., 90.])
        world_frame = np.broadcast_to(np.array([-1., 0., 1., 0.]), (3, 4))
        west_tile = sample_frame(world_frame, world_lat, world_lon, 2, 0, 1)
        east_tile = sample_frame(world_frame, world_lat, world_lon, 2, 3, 1)
        assert np.isfinite(west_tile).all() and np.isfinite(east_tile).all()
        np.testing.assert_allclose(west_tile[:, 0], east_tile[:, -1], atol=1e-6)
        assert json.loads((root / 'tiles/manifest.json').read_text())['timezone'] == 'UTC'
        for tile in (root / 'tiles').rglob('*.png'):
            with Image.open(tile) as image:
                assert image.size == (256, 256) and image.mode == 'RGBA'
        try:
            aggregate(raw, fixture=False)
            raise AssertionError('Synthetic data was allowed into production')
        except ValueError as error:
            assert 'Synthetic' in str(error)
        # A missing baseline date cannot silently produce a complete-looking atlas.
        data.isel(valid_time=slice(1, None)).to_netcdf(raw / 'fixture.nc', mode='w')
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                aggregate(raw, fixture=True)
            raise AssertionError('Missing baseline date accepted')
        except ValueError as error:
            assert 'Missing 1' in str(error)
    print('Weather atlas: daily source shape, Kelvin conversion, leap omission, complete coverage, cyclic smoothing, palette, Mercator sampling, PNG output and fixture separation pass.')

if __name__ == '__main__':
    run()
