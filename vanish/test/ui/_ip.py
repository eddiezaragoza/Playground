# Each simulated browser identifies as a different person (its own CF-Connecting-IP), like real visitors, so tests
# don't all share one person's daily creation limit. LOCAL ONLY: Cloudflare refuses any request that sends this
# header itself (403, error 1000), which is also why nobody can fake their address to dodge the limit in production.
import random
import sys
from playwright.sync_api import Browser

LOCAL = len(sys.argv) > 1 and ('localhost' in sys.argv[1] or '127.0.0.1' in sys.argv[1])

def _ip():
    return f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}"

_new_context, _new_page = Browser.new_context, Browser.new_page

def new_context(self, **kw):
    if not LOCAL:
        return _new_context(self, **kw)
    headers = dict(kw.pop('extra_http_headers', None) or {})
    headers.setdefault('CF-Connecting-IP', _ip())
    return _new_context(self, extra_http_headers=headers, **kw)

def new_page(self, **kw):
    if not LOCAL:
        return _new_page(self, **kw)
    headers = dict(kw.pop('extra_http_headers', None) or {})
    headers.setdefault('CF-Connecting-IP', _ip())
    return _new_page(self, extra_http_headers=headers, **kw)

Browser.new_context, Browser.new_page = new_context, new_page
