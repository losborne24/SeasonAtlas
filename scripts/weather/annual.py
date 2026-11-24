"""Bundle compact monthly temperature curves from the validated hourly atlas."""
import hashlib
import json
from pathlib import Path
import tempfile
import numpy as np
from build import MONTH_STARTS

NAME = 'annual-temperature-2020-2024-05deg-v1'

def build_annual(work=Path('.weather-data/arco/work'), public=Path('public/weather')):
    public.mkdir(parents=True, exist_ok=True)
    target = public / NAME
    if target.exists():
        metadata = json.loads((target / 'manifest.json').read_text())
        for hour in metadata['hours']:
            path = target / f'{hour:02}.bin'
            if hashlib.sha256(path.read_bytes()).hexdigest() != metadata['sha256'][path.name]:
                raise ValueError(f'Annual dataset checksum failed: {path}')
        print(f'Reusing verified {target}', flush=True)
        return
    with tempfile.TemporaryDirectory(prefix='.annual-', dir=public) as staging:
        output = Path(staging) / NAME
        output.mkdir()
        hashes = {}
        for hour in range(0, 24, 3):
            checkpoint = json.loads((work / f'frames-{hour:02}.json').read_text())
            if checkpoint != {'hourUTC': hour, 'days': 365, 'samplesPerCell': 75}:
                raise ValueError('Annual charts require validated five-year hourly frames.')
            frames = np.load(work / f'frames-{hour:02}.npy', mmap_mode='r')
            if frames.shape != (365, 361, 720): raise ValueError('Unexpected seasonal frame grid.')
            monthly = []
            for index, start in enumerate(MONTH_STARTS):
                end = MONTH_STARTS[index + 1] - 1 if index < 11 else 365
                values = np.mean(frames[start - 1:end], axis=0, dtype=np.float64)
                if not np.isfinite(values).all() or values.min() < -120 or values.max() > 80:
                    raise ValueError('Missing or implausible monthly temperatures.')
                monthly.append(np.rint(values * 100).astype('<i2'))
            # Each cell's 12 values are adjacent: the server reads just 24 bytes per neighbour.
            encoded = np.stack(monthly, axis=-1)
            path = output / f'{hour:02}.bin'
            path.write_bytes(encoded.tobytes())
            decoded = np.fromfile(path, dtype='<i2').reshape(361, 720, 12)
            for row, col in [(278, 365), (0, 0), (360, 719), (90, 360)]:
                for month, start in enumerate(MONTH_STARTS):
                    end = MONTH_STARTS[month + 1] - 1 if month < 11 else 365
                    reference = np.mean(frames[start - 1:end, row, col], dtype=np.float64)
                    if abs(decoded[row, col, month] / 100 - reference) > .00501:
                        raise ValueError('Monthly binary differs from the independent frame reference.')
            hashes[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
            print(f'Validated annual curves for {hour:02}:00 UTC', flush=True)
        metadata = {'version': 1, 'baseline': [2020, 2024], 'hours': list(range(0, 24, 3)),
                    'rows': 361, 'columns': 720, 'months': 12, 'south': -90, 'west': -180,
                    'resolutionDegrees': .5, 'scale': .01, 'missing': -32768,
                    'encoding': 'little-endian-int16', 'order': ['latitude', 'longitude', 'month'],
                    'method': 'Monthly means of the 15-day-smoothed seasonal temperature at the same UTC hour.',
                    'sha256': hashes}
        (output / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
        (output / 'NOTICE.txt').write_text('Modified Copernicus ERA5 via Google Research ARCO-ERA5, CC BY 4.0.\n'
            '2020–2024; monthly means of seasonal daily values, selected UTC hour; 0.5-degree spatial averaging.\n')
        output.rename(target)
    print(f'Installed annual temperature curves: {sum(p.stat().st_size for p in target.glob("*.bin")):,} bytes', flush=True)

if __name__ == '__main__':
    build_annual()
