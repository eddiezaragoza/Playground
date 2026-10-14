"""Download start/end photos for every seed exercise from free-exercise-db (Unlicense), resize to 640px with ffmpeg,
and write them to Playground/images/exercises/<dataset folder>/<n>.jpg (served by GitHub Pages).

Usage: python3 tools/fetch_photos.py <path to free-exercise-db dist/exercises.json> <download dir>
"""
import json
import pathlib
import subprocess
import sys
import urllib.request

RAW = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/'
HERE = pathlib.Path(__file__).resolve().parent
SEED = HERE.parent / 'library' / 'exercises.seed.json'
OUT = HERE.parent.parent / 'images' / 'exercises'


def main(dataset_path, download_dir):
    dataset = {e['name']: e for e in json.loads(pathlib.Path(dataset_path).read_text())}
    seed = json.loads(SEED.read_text())['exercises']
    dl = pathlib.Path(download_dir)
    done = set()
    for ex in seed:
        src = ex.get('src')
        if not src:
            continue
        for rel in dataset[src]['images']:
            if rel in done:
                continue
            done.add(rel)
            raw = dl / rel
            raw.parent.mkdir(parents=True, exist_ok=True)
            if not raw.exists():
                urllib.request.urlretrieve(RAW + rel, raw)
            out = OUT / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', str(raw), '-vf', 'scale=640:-2', '-q:v', '5', str(out)],
                           check=True)
    print(f'{len(done)} photos written to {OUT}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
