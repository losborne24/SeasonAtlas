"""Package an existing complete PNG atlas for a static Cloudflare Pages project.

Uses only Python's standard library. No downloads, credentials or cloud resources.
"""
import argparse
import hashlib
import json
import struct
import tempfile
from pathlib import Path

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_FILES = 20000
PNG = b'\x89PNG\r\n\x1a\n'


def package(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError('Output already exists; choose a fresh output directory.')
    if source == output or source in output.parents or output in source.parents:
        raise ValueError('Source and output must be separate directories.')
    manifest = json.loads((source / 'manifest.json').read_text())
    zoom = manifest.get('maxzoom')
    if (manifest.get('version') != 1 or manifest.get('kind') != 'era5'
            or manifest.get('days') != list(range(1, 366))
            or manifest.get('minzoom') != 0 or type(zoom) is not int or not 0 <= zoom <= 5
            or manifest.get('format') != 'png' or manifest.get('tileStorage') is not None
            or manifest.get('tileSize') not in (128, 256)):
        raise ValueError('Expected a complete real PNG atlas at zooms 0–5.')
    hourly = manifest.get('statistic') == 'hourly_mean'
    if not hourly and manifest.get('statistic') != 'daily_mean':
        raise ValueError('Expected daily or three-hour climatological means.')
    hours = manifest.get('hours') if hourly else [None]
    if hourly and hours != list(range(0, 24, 3)):
        raise ValueError('Expected all eight three-hour UTC frames.')
    if (manifest.get('baseline') not in ([2015, 2024], [2020, 2024])
            or manifest.get('windowDays') != 15 or manifest.get('timezone') != 'UTC'
            or manifest.get('variable') != 'temperature_2m'
            or manifest.get('resolutionDegrees') != (0.5 if hourly else 0.25)):
        raise ValueError('Unsupported baseline, averaging method or resolution.')
    if 365 * len(hours) + 6 > MAX_FILES:
        raise ValueError('Too many files for Cloudflare Pages Free.')
    notice = (source / 'NOTICE.txt').read_bytes()
    count = sum(4 ** z for z in range(zoom + 1))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.pages-weather-', dir=output.parent) as temporary:
        staging = Path(temporary)
        frames = staging / 'frames'
        frames.mkdir()
        digest = hashlib.sha256()
        total_bytes = total_tiles = largest = 0
        for hour in hours:
            prefix = Path(f'{hour:02}') if hourly else Path()
            (frames / prefix).mkdir(exist_ok=True)
            for day in manifest['days']:
                index, payload = [], bytearray()
                offset = 8 + count * 8
                for z in range(zoom + 1):
                    for y in range(2 ** z):
                        for x in range(2 ** z):
                            tile = source / prefix / str(day) / str(z) / str(x) / f'{y}.png'
                            data = tile.read_bytes()
                            if (len(data) < 24 or data[:8] != PNG or data[12:16] != b'IHDR'
                                    or struct.unpack('>II', data[16:24]) != (manifest['tileSize'],) * 2):
                                raise ValueError(f'Invalid PNG tile: {tile}')
                            index.append(struct.pack('<II', offset, len(data)))
                            payload.extend(data)
                            offset += len(data)
                pack = b'SAT1' + struct.pack('<I', count) + b''.join(index) + payload
                if len(pack) > MAX_FILE_BYTES:
                    raise ValueError(f'Frame {prefix}/{day} exceeds the 25 MiB file limit.')
                relative = prefix / f'{day}.satpack'
                (frames / relative).write_bytes(pack)
                digest.update(relative.as_posix().encode() + b'\0' + hashlib.sha256(pack).digest())
                total_bytes += len(pack)
                total_tiles += count
                largest = max(largest, len(pack))
            print(f'Packed {"daily" if hour is None else f"{hour:02}:00 UTC"}: 365 frames', flush=True)
        version = 'frames-' + digest.hexdigest()[:16]
        frames.rename(staging / version)
        manifest['tileBase'] = './' + version
        manifest['tileStorage'] = 'frame-pack-v1'
        (staging / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (staging / 'NOTICE.txt').write_bytes(notice)
        (staging / '_headers').write_text(
            '/*\n  Access-Control-Allow-Origin: *\n'
            '  X-Content-Type-Options: nosniff\n  X-Robots-Tag: noindex\n\n'
            '/manifest.json\n  Cache-Control: no-cache\n\n'
            '/:version/*\n  Cache-Control: public, max-age=31536000, immutable\n'
        )
        (staging / 'index.html').write_text(
            '<!doctype html><html lang="en"><meta charset="utf-8">'
            '<title>SeasonAtlas temperature data</title>'
            '<h1>SeasonAtlas temperature data</h1><p>Copernicus ERA5 historical averages.</p>'
            '<p><a href="NOTICE.txt">Data attribution</a> · <a href="manifest.json">Atlas manifest</a></p></html>\n'
        )
        # Prevent Pages from returning an SPA index.html for missing bundles.
        (staging / '404.html').write_text('<!doctype html><title>Not found</title><h1>Temperature data not found</h1>\n')
        report = {'format': 'frame-pack-v1', 'frames': 365 * len(hours), 'tiles': total_tiles,
                  'packBytes': total_bytes, 'largestPackBytes': largest, 'version': version}
        (staging / 'packaging.json').write_text(json.dumps(report, indent=2) + '\n')
        files = [p for p in staging.rglob('*') if p.is_file()]
        if len(files) > MAX_FILES or any(p.stat().st_size > MAX_FILE_BYTES for p in files):
            raise ValueError('Output exceeds Cloudflare Pages Free limits.')
        # Keep the target invisible until all validation has passed.
        staging.rename(output)
    print(json.dumps({**report, 'files': len(files), 'output': str(output)}, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('.weather-data/pages-temperature'))
    args = parser.parse_args()
    package(args.source, args.output)
