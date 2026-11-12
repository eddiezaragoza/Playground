# Replies: desktop (hover ↩) and phone (smiley menu), quote on both screens, jump to original, reply to a photo, Esc cancels.
import sys
from playwright.sync_api import sync_playwright
import _ip  # noqa: F401  (each browser = a different person)
B = sys.argv[1]; code = open(sys.argv[2]).read(); OUT = sys.argv[3]; errors = []
with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_context(viewport={'width': 1100, 'height': 650}).new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(B + '/chat'); pg.wait_for_selector('#rname')
    pg.click('button.primary.wide'); pg.wait_for_selector('input.link'); room = pg.input_value('input.link')
    pg.goto(room); pg.fill('#name', 'Eddie'); pg.click('button[type=submit]'); pg.wait_for_selector('.composer textarea')
    m = br.new_context(**p.devices['iPhone 14']).new_page(); m.on('pageerror', lambda e: errors.append(str(e)))
    m.goto(room); m.fill('#name', 'Sam'); m.click('button[type=submit]'); m.wait_for_selector('.composer textarea')
    pg.fill('.composer textarea', 'who wants tacos at noon?'); pg.keyboard.press('Enter')
    for i in range(12): pg.fill('.composer textarea', f'filler {i}'); pg.keyboard.press('Enter')
    m.wait_for_selector('.row >> text=filler 11')
    # Phone: reply via the smiley menu on the first message
    first = m.locator('.row', has_text='who wants tacos')
    first.scroll_into_view_if_needed(); first.locator('.react-btn').tap(); m.wait_for_selector('.picker-reply')
    print('phone has no separate reply button:', m.locator('.reply-btn').first.is_hidden())
    m.locator('.picker-reply').tap(); m.wait_for_selector('.reply-bar:not([hidden])'); print('phone reply bar:', m.inner_text('.reply-bar').replace('\n', ' '))
    m.screenshot(path=f'{OUT}/reply-bar-phone.png')
    m.fill('.composer textarea', 'me!'); m.locator('.composer button[type=submit]').tap()
    pg.wait_for_selector('.quote'); print('Eddie sees quote:', pg.inner_text('.quote').replace('\n', ' | '), '| reply bar gone on phone:', m.locator('.reply-bar').is_hidden())
    # Desktop: click the quote, the original scrolls into view and flashes
    pg.locator('.quote').last.click(); pg.wait_for_selector('.row.flash'); print('jump to original highlights:', pg.inner_text('.row.flash .body'))
    # Desktop: hover-reply to Sam's message, then Esc cancels
    sam = pg.locator('.row', has_text='me!').last; sam.hover(); sam.locator('.reply-btn').click(); pg.wait_for_selector('.reply-bar:not([hidden])')
    print('desktop reply bar:', pg.inner_text('.reply-bar').replace('\n', ' ')); pg.keyboard.press('Escape'); print('Esc cancels reply:', pg.locator('.reply-bar').is_hidden())
    # Reply to a photo: quote says 📷 Photo
    png = pg.evaluate("""async () => { const c=document.createElement('canvas'); c.width=400; c.height=300; const g=c.getContext('2d'); g.fillStyle='#e85d75'; g.fillRect(0,0,400,300);
      const b=await new Promise(r=>c.toBlob(r,'image/png')); return Array.from(new Uint8Array(await b.arrayBuffer())); }""") if False else None
    pg.set_input_files('.composer input[type=file]', files=[{'name': 'a.png', 'mimeType': 'image/png', 'buffer': open(sys.argv[4], 'rb').read()}]) if len(sys.argv) > 4 else None
    if len(sys.argv) > 4:
        pg.wait_for_selector('.tray img'); pg.click('.composer button[type=submit]'); m.wait_for_selector('.photo')
        ph = m.locator('.row', has=m.locator('.photo')).last; ph.locator('.react-btn').tap(); m.locator('.picker-reply').tap()
        m.fill('.composer textarea', 'nice pic'); m.locator('.composer button[type=submit]').tap()
        pg.wait_for_selector('.quote >> text=Photo'); print('reply to photo quote:', pg.locator('.quote').last.inner_text().replace('\n', ' | '))
    pg.screenshot(path=f'{OUT}/reply-desktop.png'); m.screenshot(path=f'{OUT}/reply-phone.png')
    br.close()
print('ERRORS:', errors)
