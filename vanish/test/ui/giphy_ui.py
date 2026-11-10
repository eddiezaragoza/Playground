import sys
from playwright.sync_api import sync_playwright
B=sys.argv[1]; code=open(sys.argv[2]).read(); S=sys.argv[3]; errors=[]
with sync_playwright() as p:
    br=p.chromium.launch(); pg=br.new_context(viewport={'width':1100,'height':700}).new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type=='error' and 'cloudflareinsights' not in m.text and errors.append(m.text))
    pg.goto(B+'/chat'); pg.fill('#code',code); pg.click('button[type=submit]'); pg.wait_for_selector('#rname')
    pg.click('button.primary.wide'); pg.wait_for_selector('input.link'); room=pg.input_value('input.link')
    pg.goto(room); pg.fill('#name','Eddie'); pg.click('button[type=submit]'); pg.wait_for_selector('.composer textarea')
    m=br.new_context(viewport={'width':320,'height':640}).new_page(); m.on('pageerror', lambda e: errors.append(str(e)))
    m.goto(room); m.fill('#name','Sam'); m.click('button[type=submit]'); m.wait_for_selector('.composer textarea')
    pg.click('.gif-btn'); pg.wait_for_selector('.gif-pick img'); print('trending shown:', pg.locator('.gif-pick').count(), 'GIFs | attribution:', pg.inner_text('.giphy-attr'))
    first=pg.get_attribute('.gif-pick','title'); pg.fill('.gif-search','thumbs up'); pg.wait_for_function if False else None
    for _ in range(40):
        pg.wait_for_timeout(250)
        if pg.locator('.gif-pick').count() and pg.get_attribute('.gif-pick','title')!=first: break
    print('search "thumbs up":', pg.locator('.gif-pick').count(), 'results, e.g.', [pg.locator('.gif-pick').nth(i).get_attribute('title') for i in range(3)])
    pg.wait_for_timeout(1500)
    pg.screenshot(path=f'{S}/giphy-panel.png')
    pg.locator('.gif-pick').first.click(); print('panel closed after pick:', pg.locator('.gif-panel').is_hidden())
    m.wait_for_selector('.photo.gif.loaded'); print('Sam sees the GIF:', True)
    m.click('.photo.gif'); m.wait_for_selector('.lightbox img'); print('lightbox:', m.inner_text('.lightbox-bar').replace('\n',' ')); m.keyboard.press('Escape')
    # phone composer fits at 320px
    bb=m.locator('.composer button[type=submit]').bounding_box(); print('320px: Send button inside screen:', bb['x']+bb['width']<=320)
    m.click('.gif-btn'); m.wait_for_selector('.gif-pick img'); m.screenshot(path=f'{S}/giphy-phone.png'); m.keyboard.press('Escape')
    br.close()
print('ERRORS:', errors)
