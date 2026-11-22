"""Resumable monthly CDS downloads of 24-hour UTC mean 2 m temperature."""
import argparse
import calendar
import json
import os
import zipfile
from pathlib import Path

DATASET = 'derived-era5-single-levels-daily-statistics'
BOUNDS = [72, -25, 34, 45]  # north, west, south, east

def download_format(path):
    """Single-variable CDS results can be direct NetCDF or a NetCDF ZIP."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            if archive.testzip() is not None or not any(n.endswith('.nc') for n in archive.namelist()):
                raise ValueError(f'Invalid CDS archive: {path}')
        return '.zip'
    from netCDF4 import Dataset
    with Dataset(path) as data:
        if 't2m' not in data.variables or getattr(data.variables['t2m'], 'units', None) != 'K':
            raise ValueError(f'Expected ERA5 Kelvin temperature in {path}')
        data.variables['t2m'][:]  # Ensure the completed payload can actually be decoded.
    return '.nc'

def request_for(year, month):
    return {
        'product_type': 'reanalysis', 'variable': ['2m_temperature'],
        'year': str(year), 'month': [f'{month:02}'],
        'day': [f'{d:02}' for d in range(1, calendar.monthrange(year, month)[1] + 1)],
        'daily_statistic': 'daily_mean', 'time_zone': 'utc+00:00',
        'frequency': '1_hourly', 'area': BOUNDS,
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.weather-data/raw'))
    parser.add_argument('--years', type=int, nargs='+', default=list(range(2015, 2025)))
    parser.add_argument('--months', type=int, nargs='+', default=list(range(1, 13)))
    parser.add_argument('--dry-run', action='store_true', help='Print requests without credentials or downloads')
    args = parser.parse_args()
    if any(y < 2015 or y > 2024 for y in args.years) or any(m < 1 or m > 12 for m in args.months):
        parser.error('Use baseline years 2015–2024 and months 1–12.')
    if args.dry_run:
        print(json.dumps({'dataset': DATASET, 'requests': [request_for(y, m) for y in args.years for m in args.months]}, indent=2))
        return
    if not (Path.home() / '.cdsapirc').is_file() and not os.getenv('CDSAPI_KEY'):
        parser.error('Configure ~/.cdsapirc locally first: https://cds.climate.copernicus.eu/en/how-to-api. Do not put tokens in this repository.')
    import cdsapi
    client = cdsapi.Client()
    args.directory.mkdir(parents=True, exist_ok=True)
    for year in args.years:
        for month in args.months:
            stem = args.directory / f'era5-daily-{year}-{month:02}'
            request = request_for(year, month)
            record = stem.with_suffix('.request.json')
            completed = next((stem.with_suffix(ext) for ext in ['.nc', '.zip'] if stem.with_suffix(ext).is_file()), None)
            if completed and record.is_file() and json.loads(record.read_text()) == {'dataset': DATASET, 'request': request}:
                print(f'Reusing {completed}', flush=True)
                continue
            temporary = stem.with_suffix('.part')
            client.retrieve(DATASET, request, str(temporary))
            target = stem.with_suffix(download_format(temporary))
            temporary.replace(target)
            record.write_text(json.dumps({'dataset': DATASET, 'request': request}, indent=2) + '\n')
            print(f'Downloaded {target}', flush=True)

if __name__ == '__main__':
    main()
