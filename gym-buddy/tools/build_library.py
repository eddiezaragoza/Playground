"""Create (once) and upsert the Notion "Exercise Library" from library/exercises.seed.json.

Env: NOTION_TOKEN (an integration that can edit the parent page). Never commit a token.
Usage:
  python3 tools/build_library.py create <parent_page_id> <free-exercise-db exercises.json>   -> prints the new data source id
  python3 tools/build_library.py upsert <data_source_id>   <free-exercise-db exercises.json>
Rows are matched by Name, so re-running updates instead of duplicating.
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

API = 'https://api.notion.com/v1'
VERSION = '2026-03-11'
SITE = 'https://eddiezaragoza.com/images/exercises/'
HERE = pathlib.Path(__file__).resolve().parent
SEED = HERE.parent / 'library' / 'exercises.seed.json'

CATEGORIES = ['Warm-up', 'Strength', 'Accessory', 'Conditioning', 'Mobility']
PATTERNS = ['Squat', 'Hinge', 'Push', 'Pull', 'Lunge', 'Core', 'Carry', 'Arms', 'Cardio', 'Mobility', 'Stretch']
EQUIPMENT = ['Dumbbells', 'Kettlebell', 'Pull-up Bar', 'Dip Station', 'Bodyweight', 'Mat', 'Chair/Step', 'Outdoors']


def call(path, method='GET', body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + os.environ['NOTION_TOKEN'],
                                          'Notion-Version': VERSION, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path} -> {e.code}: {e.read().decode()[:400]}')


def opts(names):
    return {'options': [{'name': n} for n in names]}


def rt(text):
    return [{'type': 'text', 'text': {'content': text[i:i + 2000]}} for i in range(0, len(text), 2000)]


def create(parent_page_id):
    db = call('/databases', 'POST', {
        'parent': {'type': 'page_id', 'page_id': parent_page_id},
        'title': [{'type': 'text', 'text': {'content': 'Exercise Library'}}],
        'icon': {'type': 'emoji', 'emoji': '🏋️'},
        'initial_data_source': {'properties': {
            'Name': {'title': {}},
            'Category': {'select': opts(CATEGORIES)},
            'Pattern': {'select': opts(PATTERNS)},
            'Equipment': {'multi_select': opts(EQUIPMENT)},
            'Anchor': {'checkbox': {}},
            'Photo Match': {'select': {'options': [{'name': 'Exact', 'color': 'green'}, {'name': 'Close', 'color': 'yellow'},
                                                   {'name': 'None', 'color': 'gray'}]}},
            'Photo Note': {'rich_text': {}},
            'Cue': {'rich_text': {}},
            'Steps': {'rich_text': {}},
            'Also Called': {'rich_text': {}},
            'Image Start': {'url': {}},
            'Image End': {'url': {}},
            'Video': {'url': {}},
            'Source': {'rich_text': {}},
        }},
    })
    return db['data_sources'][0]['id']


def row_properties(ex, dataset):
    src = dataset.get(ex.get('src')) if ex.get('src') else None
    steps = ex.get('steps') or (src['instructions'] if src else [])
    imgs = [SITE + p for p in src['images']] if src else []
    query = urllib.parse.quote_plus(f"{ex['name']} exercise proper form")
    props = {
        'Name': {'title': rt(ex['name'])},
        'Category': {'select': {'name': ex['category']}},
        'Pattern': {'select': {'name': ex['pattern']}},
        'Equipment': {'multi_select': [{'name': e} for e in ex['equipment']]},
        'Anchor': {'checkbox': bool(ex.get('anchor'))},
        'Photo Match': {'select': {'name': ex['match']}},
        'Photo Note': {'rich_text': rt(ex.get('note', ''))},
        'Cue': {'rich_text': rt(ex.get('cue', ''))},
        'Steps': {'rich_text': rt('\n'.join(f'{i + 1}. {s.strip()}' for i, s in enumerate(steps)))},
        'Also Called': {'rich_text': rt(ex.get('also', ''))},
        'Image Start': {'url': imgs[0] if imgs else None},
        'Image End': {'url': imgs[1] if len(imgs) > 1 else None},
        'Video': {'url': f'https://www.youtube.com/results?search_query={query}'},
        'Source': {'rich_text': rt(f"free-exercise-db: {ex['src']} (Unlicense)" if src else 'Written for Gym Buddy')},
    }
    cover = {'type': 'external', 'external': {'url': imgs[0]}} if imgs else None
    return props, cover


def upsert(ds_id, dataset):
    existing, cursor = {}, None
    while True:
        body = {'page_size': 100, **({'start_cursor': cursor} if cursor else {})}
        res = call(f'/data_sources/{ds_id}/query', 'POST', body)
        for p in res['results']:
            existing[''.join(t['plain_text'] for t in p['properties']['Name']['title'])] = p['id']
        if not res.get('has_more'):
            break
        cursor = res['next_cursor']
    created = updated = 0
    for ex in json.loads(SEED.read_text())['exercises']:
        props, cover = row_properties(ex, dataset)
        if ex['name'] in existing:
            call(f"/pages/{existing[ex['name']]}", 'PATCH', {'properties': props, **({'cover': cover} if cover else {})})
            updated += 1
        else:
            call('/pages', 'POST', {'parent': {'type': 'data_source_id', 'data_source_id': ds_id}, 'properties': props,
                                    **({'cover': cover} if cover else {})})
            created += 1
    print(f'created {created}, updated {updated}')


if __name__ == '__main__':
    cmd, target, dataset_path = sys.argv[1:4]
    data = {e['name']: e for e in json.loads(pathlib.Path(dataset_path).read_text())}
    if cmd == 'create':
        ds = create(target)
        print('data source id:', ds)
        upsert(ds, data)
    else:
        upsert(target, data)
