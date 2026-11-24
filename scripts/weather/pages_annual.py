"""Add annual-chart latitude strips to an existing static Pages tile upload."""
import argparse
import hashlib
import json
import tempfile
from pathlib import Path

ROWS, COLUMNS, MONTHS = 361, 720, 12
ROW_BYTES = COLUMNS * MONTHS * 2


def package_annual(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    atlas = json.loads((output / 'manifest.json').read_text())
    if atlas.get('tileStorage') != 'frame-pack-v1':
        raise ValueError('Output must be an existing Pages temperature package.')
    metadata = json.loads((source / 'manifest.json').read_text())
    expected = {'version': 1, 'baseline': [2020, 2024], 'hours': list(range(0, 24, 3)),
                'rows': ROWS, 'columns': COLUMNS, 'months': MONTHS, 'south': -90, 'west': -180,
                'resolutionDegrees': .5, 'scale': .01, 'missing': -32768,
                'encoding': 'little-endian-int16', 'order': ['latitude', 'longitude', 'month']}
    if any(metadata.get(key) != value for key, value in expected.items()):
        raise ValueError('Unsupported annual temperature grid or encoding.')
    hashes = metadata.get('sha256', {})
    digest = hashlib.sha256()
    for hour in expected['hours']:
        name = f'{hour:02}.bin'
        data = (source / name).read_bytes()
        if len(data) != ROWS * ROW_BYTES or hashlib.sha256(data).hexdigest() != hashes.get(name):
            raise ValueError(f'Incomplete or changed annual data: {name}')
        digest.update(name.encode() + b'\0' + hashlib.sha256(data).digest())
    version = 'annual-' + digest.hexdigest()[:16]
    target = output / version
    existing = [p for p in output.rglob('*') if p.is_file()]
    new_count = 0 if target.exists() else ROWS * 8 + 1
    if len(existing) + new_count + (not (output / 'annual-manifest.json').exists()) > 20000:
        raise ValueError('Combined package exceeds the Pages Free file limit.')
    if any(p.stat().st_size > 25 * 1024 * 1024 for p in existing):
        raise ValueError('Existing package contains an oversized file.')
    with tempfile.TemporaryDirectory(prefix='.annual-pages-', dir=output.parent) as temporary:
        staging = Path(temporary) / version
        staging.mkdir()
        for hour in expected['hours']:
            data = (source / f'{hour:02}.bin').read_bytes()
            if hashlib.sha256(data).hexdigest() != hashes[f'{hour:02}.bin']:
                raise ValueError('Annual data changed during packaging.')
            folder = staging / f'{hour:02}'
            folder.mkdir()
            for row in range(ROWS):
                (folder / f'{row}.bin').write_bytes(data[row * ROW_BYTES:(row + 1) * ROW_BYTES])
        (staging / 'NOTICE.txt').write_bytes((source / 'NOTICE.txt').read_bytes())
        if target.exists():
            names = [p.relative_to(staging) for p in staging.rglob('*') if p.is_file()]
            if (set(names) != {p.relative_to(target) for p in target.rglob('*') if p.is_file()}
                    or any((staging / p).read_bytes() != (target / p).read_bytes() for p in names)):
                raise ValueError('Existing annual version differs; refusing to overwrite it.')
        else:
            staging.rename(target)
    headers_path = output / '_headers'
    headers = headers_path.read_text()
    if '/annual-manifest.json\n' not in headers:
        pending = output / '.headers-next'
        pending.write_text(headers + '\n/annual-manifest.json\n  Cache-Control: no-cache\n')
        pending.replace(headers_path)
    metadata['rowStorage'] = 'latitude-rows-v1'
    metadata['rowBase'] = './' + version
    pending = output / '.annual-manifest-next.json'
    pending.write_text(json.dumps(metadata, indent=2) + '\n')
    pending.replace(output / 'annual-manifest.json')
    files = [p for p in output.rglob('*') if p.is_file()]
    print(json.dumps({'annualBytes': ROWS * ROW_BYTES * 8, 'annualFiles': ROWS * 8 + 2,
                      'rowBytes': ROW_BYTES, 'totalFiles': len(files),
                      'totalBytes': sum(p.stat().st_size for p in files),
                      'output': str(output), 'version': version}, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('public/weather/annual-temperature-2020-2024-05deg-v1'))
    parser.add_argument('--output', type=Path, default=Path('.weather-data/pages-temperature'))
    args = parser.parse_args()
    package_annual(args.source, args.output)
