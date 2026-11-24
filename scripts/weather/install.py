"""Publish generated tiles beside the app; atomically switch its small manifest last."""
import argparse
import json
import os
import shutil
from pathlib import Path

def install(source, public=Path('public/weather')):
    manifest = json.loads((source / 'manifest.json').read_text())
    if manifest.get('kind') != 'era5' or manifest.get('days') != list(range(1, 366)):
        raise ValueError('Only a complete real atlas can be installed.')
    if manifest.get('statistic') == 'hourly_mean':
        if manifest.get('hours') != list(range(0, 24, 3)):
            raise ValueError('The hourly atlas must include all eight UTC hours.')
        for hour in manifest['hours']:
            if len(list((source / f'{hour:02}').rglob('*.png'))) != 365 * sum(4 ** z for z in range(manifest['maxzoom'] + 1)):
                raise ValueError(f'Incomplete hourly tiles at {hour:02}:00 UTC.')
    if not source.name.replace('-', '').isalnum():
        raise ValueError('Atlas version name must contain only letters, digits and hyphens.')
    public.mkdir(parents=True, exist_ok=True)
    target = public / source.name
    if not target.exists():
        staging = public / ('.install-' + source.name)
        if staging.exists():
            # This directory is private staging, never the active published atlas.
            shutil.rmtree(staging)
        def link_or_copy(src, dst):
            try: os.link(src, dst)
            except OSError: shutil.copy2(src, dst)
        shutil.copytree(source, staging, copy_function=link_or_copy)
        staging.rename(target)
    elif (target / 'manifest.json').read_bytes() != (source / 'manifest.json').read_bytes():
        raise ValueError('Version already exists with different data; choose a new version name.')
    manifest['tileBase'] = '/weather/' + source.name
    temporary = public / '.manifest-next.json'
    temporary.write_text(json.dumps(manifest, indent=2) + '\n')
    temporary.replace(public / 'manifest.json')
    print(f'Installed {source.name} at {manifest["tileBase"]}; app manifest switched atomically.', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--public', type=Path, default=Path('public/weather'))
    args = parser.parse_args()
    install(args.source, args.public)
