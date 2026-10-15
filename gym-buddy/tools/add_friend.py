"""Onboard a friend: their Notion page + empty log (same columns as Eddie's), and a website login.

Env: NOTION_TOKEN (an integration that can edit the friends container page). Never commit a token.
Usage (run from gym-buddy/):
  python3 tools/add_friend.py <username> "<Display Name>" <friends container page id> [--local]
  python3 tools/add_friend.py --remove <username> [--local]

--local writes the login to the local `wrangler dev` KV instead of production.
Prints the password ONCE. Only a salted PBKDF2 hash is stored, so it can't be recovered, only reset by re-running.
"""
import base64
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

API = 'https://api.notion.com/v1'
VERSION = '2026-03-11'
EDDIE_LOG = '0d083beb-504f-4522-b761-d41fc5c9f561'  # schema template
ITERATIONS = 100000  # Cloudflare Workers' PBKDF2 ceiling
WORDS = ('amber anchor apple arrow aspen atlas bamboo basil beacon birch bison blaze breeze brook cactus canyon cedar '
         'cobalt comet coral cosmo crane crisp delta dune eagle ember falcon fern fjord flint forge frost galaxy garnet '
         'glacier granite harbor hazel heron honey indigo iris island jade jasper juniper kayak kelp kestrel lagoon '
         'lantern lemon lilac linen lotus lunar maple marble meadow mesa mint monsoon moss nectar nova oak ocean olive '
         'onyx orbit otter pebble pepper pine planet plume prairie quartz quill raven reef ridge river robin saffron '
         'sage sapphire shadow sierra slate spruce summit sunset tango thistle thunder tiger timber topaz tulip tundra '
         'valley velvet violet walnut willow zephyr').split()


def call(path, method='GET', body=None):
    req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={'Authorization': 'Bearer ' + os.environ['NOTION_TOKEN'],
                                          'Notion-Version': VERSION, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as res:
            return json.load(res)
    except urllib.error.HTTPError as e:
        raise SystemExit(f'{method} {path} -> {e.code}: {e.read().decode()[:400]}')


def log_schema():
    """Eddie's log columns, minus ids, so every friend's log matches what the website and coach expect."""
    props = {}
    for name, p in call(f'/data_sources/{EDDIE_LOG}')['properties'].items():
        t = p['type']
        if t in ('select', 'multi_select'):
            props[name] = {t: {'options': [{'name': o['name'], 'color': o['color']} for o in p[t]['options']]}}
        elif t in ('title', 'rich_text', 'number', 'checkbox', 'date', 'url'):
            props[name] = {t: {}}
    return props


def wrangler_kv(args, local):
    cmd = ['npx', 'wrangler', 'kv', 'key', *args, '--binding', 'GB_KV', '--local' if local else '--remote']
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(f'wrangler failed: {out.stderr[-400:]}')


def add(username, display, container, local):
    if not re.fullmatch(r'[a-z0-9-]{1,32}', username) or username == 'eddie':
        raise SystemExit('username must be lowercase letters, digits or dashes, and not "eddie"')
    page = call('/pages', 'POST', {
        'parent': {'type': 'page_id', 'page_id': container},
        'icon': {'type': 'emoji', 'emoji': '🏋️'},
        'properties': {'title': {'title': [{'text': {'content': f'Gym Buddy - {display}'}}]}},
    })
    db = call('/databases', 'POST', {
        'parent': {'type': 'page_id', 'page_id': page['id']},
        'title': [{'type': 'text', 'text': {'content': f'Gym Buddy Log - {display}'}}],
        'initial_data_source': {'properties': log_schema()},
    })
    ds = db['data_sources'][0]['id']

    password = '-'.join(secrets.choice(WORDS) for _ in range(3)) + str(secrets.randbelow(90) + 10)
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, ITERATIONS)
    record = {'name': display, 'ds': ds, 'salt': base64.b64encode(salt).decode(),
              'hash': base64.b64encode(digest).decode(), 'iter': ITERATIONS}
    wrangler_kv(['put', f'user:{username}', json.dumps(record)], local)

    print(json.dumps({'username': username, 'password': password, 'page_id': page['id'], 'page_url': page['url'],
                      'log_database_id': db['id'], 'log_data_source_id': ds}, indent=2))


if __name__ == '__main__':
    a = sys.argv[1:]
    local = '--local' in a
    a = [x for x in a if x != '--local']
    if a and a[0] == '--remove':
        wrangler_kv(['delete', f'user:{a[1]}'], local)
        print(f'removed login {a[1]} (their Notion page and log are untouched)')
    else:
        add(a[0], a[1], a[2], local)
