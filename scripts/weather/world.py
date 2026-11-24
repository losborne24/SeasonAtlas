"""Run the resumable world download → bounded-memory build → validation → app install."""
import argparse
import json
import re
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.weather-data/world-status.json'
BASELINE = (2020, 2024)
TOTAL_MONTHS = (BASELINE[1] - BASELINE[0] + 1) * 12
ATLAS_NAME = f'global-temperature-{BASELINE[0]}-{BASELINE[1]}-v1'

def status(stage, **details):
    record = {'stage': stage, 'baseline': list(BASELINE), 'updatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), **details}
    temporary = STATE.with_suffix('.next.json')
    temporary.write_text(json.dumps(record, indent=2) + '\n')
    temporary.replace(STATE)
    print(json.dumps(record), flush=True)

def step(script, *arguments):
    subprocess.run([sys.executable, str(ROOT / 'scripts/weather' / script), *map(str, arguments)], cwd=ROOT, check=True)

def download(month, completed):
    year, number = month
    logs = ROOT / '.weather-data/world-jobs'
    logs.mkdir(parents=True, exist_ok=True)
    log = logs / f'{year}-{number:02}.log'
    with log.open('a') as output:
        command = [sys.executable, 'scripts/weather/fetch.py', '--global', '--years', str(year), '--months', str(number)]
        child = subprocess.Popen(command, cwd=ROOT, stdout=output, stderr=subprocess.STDOUT)
        while True:
            try:
                code = child.wait(timeout=20)
                if code:
                    raise subprocess.CalledProcessError(code, command)
                return month
            except subprocess.TimeoutExpired:
                text = log.read_text()
                states = re.findall(r'status has been updated to (\w+)', text)
                status('downloading', completed=completed, total=TOTAL_MONTHS, active=f'{year}-{number:02}',
                       providerState=states[-1] if states else 'connecting')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workers', type=int, choices=range(1, 9), default=4, help='Local tile-render workers; provider requests are strictly sequential')
    args = parser.parse_args()
    STATE.parent.mkdir(parents=True, exist_ok=True)
    # Prevent two pipelines from publishing competing progress or builds.
    import fcntl
    with (STATE.parent / 'world.lock').open('w') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise SystemExit('A world pipeline is already running.')
        try:
            raw = ROOT / '.weather-data/raw-global'
            months = [(year, month) for year in range(BASELINE[0], BASELINE[1] + 1) for month in range(1, 13)]
            status('downloading', completed=0, total=TOTAL_MONTHS)
            completed = 0
            for month in months:
                year, number = download(month, completed)
                completed += 1
                status('downloading', completed=completed, total=TOTAL_MONTHS, latest=f'{year}-{number:02}')
                # Leave a small gap between requests, including cache hits.
                time.sleep(3)
            atlas = ROOT / '.weather-data/tiles' / ATLAS_NAME
            if not (atlas / 'manifest.json').exists():
                if atlas.exists():
                    # Resuming an interrupted render is safe only for private, unpublished output.
                    # Regenerate it completely; never modify the installed app version.
                    import shutil
                    shutil.rmtree(atlas)
                status('building', completed=TOTAL_MONTHS, total=TOTAL_MONTHS)
                step('build.py', '--global', '--start-year', BASELINE[0], '--end-year', BASELINE[1], '--output', atlas, '--workers', args.workers)
            status('validating', completed=TOTAL_MONTHS, total=TOTAL_MONTHS)
            step('validate.py', '--raw', raw, '--directory', atlas)
            status('installing', completed=TOTAL_MONTHS, total=TOTAL_MONTHS)
            step('install.py', '--source', atlas)
            size = sum(file.stat().st_size for file in atlas.rglob('*') if file.is_file())
            status('ready', completed=TOTAL_MONTHS, total=TOTAL_MONTHS, tileBytes=size, tileBase='/weather/' + ATLAS_NAME)
        except Exception as error:
            status('failed', error=str(error))
            raise

if __name__ == '__main__':
    main()
