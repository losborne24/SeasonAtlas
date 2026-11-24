"""Check spatial aggregation, polar/seam handling, and hour-isolated seasonal means."""
from datetime import date
import numpy as np
from arco import half_degree, dates
from build import smooth
from install import install
from pathlib import Path
import tempfile
import json
from arco import manifest

latitude = np.arange(90., -90.01, -.25)
native = np.arange(721 * 1440, dtype=np.float32).reshape(721, 1440) / 10000 + 200
coarse = half_degree(native, latitude)
assert coarse.shape == (361, 720)
for row, col in [(0, 0), (360, 719), (278, 365), (180, 360)]:
    native_row = 720 - row * 2
    native_col = ((col - 360) % 720) * 2
    total = weight = 0.
    for dy, wy in [(-1, .25), (0, .5), (1, .25)]:
        r = native_row + dy
        if not 0 <= r < 721: continue
        for dx, wx in [(-1, .25), (0, .5), (1, .25)]:
            w = wy * wx * max(np.cos(np.radians(latitude[r])), 0.)
            total += float(native[r, (native_col + dx) % 1440]) * w
            weight += w
    assert abs(float(coarse[row, col]) - total / weight) < 3e-5
assert np.allclose(half_degree(np.full((721, 1440), 280.), latitude), 280)
sums = np.arange(365, dtype=np.float64)[:, None, None] * 5
counts = np.full(sums.shape, 5, dtype=np.uint16)
frames, coverage = smooth(sums, counts, year_count=5)
assert np.all(coverage == 75)
assert abs(float(frames[0, 0, 0]) - np.mean([d % 365 for d in range(-7, 8)])) < 1e-5
assert len(list(dates(date(2020, 1, 1), date(2024, 12, 31)))) == 1825
assert len(list(dates(date(2020, 2, 28), date(2020, 3, 1)))) == 2
with tempfile.TemporaryDirectory() as temp:
    source = Path(temp) / 'trial'
    source.mkdir()
    (source / 'manifest.json').write_text(json.dumps(manifest('sample', [196], '2020-07-15')))
    try: install(source, Path(temp) / 'public')
    except ValueError: pass
    else: raise AssertionError('A one-day sample must never become the active atlas.')
    (source / 'manifest.json').write_text(json.dumps(manifest('era5', list(range(1, 366)))))
    try: install(source, Path(temp) / 'public')
    except ValueError: pass
    else: raise AssertionError('A manifest without its eight complete tile sets must not install.')
print('ARCO checks passed: independent area weights, poles, longitude seam, 75-sample cyclic mean, leap omission.')
