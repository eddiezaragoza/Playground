import sys, json
from playwright.sync_api import sync_playwright
B=sys.argv[1]; code=open(sys.argv[2]).read(); OUT=sys.argv[3]; GIF=sys.argv[4]
AUDIT = """(() => {
  const vw = document.documentElement.clientWidth, out = {overflow: document.documentElement.scrollWidth - vw, small: [], zoomInputs: []};
  for (const e of document.querySelectorAll('button, a.button, input, select, textarea, nav a, .chip')) {
    const r = e.getBoundingClientRect(); if (!r.width || getComputedStyle(e).visibility==='hidden' || e.closest('[hidden]') || e.classList.contains('offscreen')) continue;
    if (Math.min(r.width, r.height) < 36) out.small.push((e.className||e.tagName)+' '+(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,18)+' '+Math.round(r.width)+'x'+Math.round(r.height));
    if (/INPUT|TEXTAREA|SELECT/.test(e.tagName) && parseFloat(getComputedStyle(e).fontSize) < 16) out.zoomInputs.push(e.id||e.className);
    if (r.right > vw + 1) out.small.push('OFFSCREEN '+(e.className||e.tagName));
  }
  out.small = [...new Set(out.small)]; return out; })()"""
devs = {'iPhoneSE': 'iPhone SE', 'iPhone14': 'iPhone 14', 'Pixel7': 'Pixel 7', 'GalaxyS9': 'Galaxy S9+', 'iPhone14-land': 'iPhone 14 landscape'}
with sync_playwright() as p:
    br = p.chromium.launch()
    # set up a busy room once (desktop host)
    h = br.new_context(bypass_csp=True).new_page()
    h.goto(B+'/chat'); h.fill('#code', code); h.click('button[type=submit]'); h.wait_for_selector('#rname')
    h.fill('#rname','Lunch crew'); h.click('button.primary.wide'); h.wait_for_selector('input.link'); room = h.input_value('input.link')
    h.goto(room); h.fill('#name','Eddie'); h.click('button[type=submit]'); h.wait_for_selector('.composer textarea')
    for t in ['morning all', 'who is in for tacos at noon? the new place on 5th has a long line so we should leave by 11:45 to be safe', 'me!']:
        h.fill('.composer textarea', t); h.keyboard.press('Enter')
    h.set_input_files('.composer input[type=file]', GIF); h.wait_for_selector('.tray img'); h.click('.composer button[type=submit]')
    h.click('.gif-btn'); h.wait_for_selector('.gif-pick img'); h.locator('.gif-pick').first.click()
    h.wait_for_timeout(500)
    h.hover('.row >> nth=1'); h.locator('.react-btn').nth(1).click(); h.click('.picker button:has-text("🔥")')
    report = {}
    for name, d in devs.items():
        ctx = br.new_context(**p.devices[d], bypass_csp=True); pg = ctx.new_page(); res = {}
        def snap(tag):
            pg.wait_for_timeout(400); res[tag] = pg.evaluate(AUDIT); pg.screenshot(path=f'{OUT}/{name}-{tag}.png')
        pg.goto(B+'/secret'); pg.wait_for_selector('#code'); snap('login')
        pg.fill('#code', code); pg.click('button[type=submit]'); pg.wait_for_selector('#text'); snap('create')
        pg.fill('#text','wifi: guest / pass: tacos4all'); pg.click('button.primary.wide'); pg.wait_for_selector('input.link'); snap('created'); link = pg.input_value('input.link')
        v = ctx.new_page(); pg2 = pg; pg = v
        pg.goto(link); pg.wait_for_selector('button[type=submit]'); snap('view'); pg.click('button[type=submit]'); pg.wait_for_selector('.secret pre'); snap('revealed')
        pg = pg2
        pg.goto(B+'/chat'); pg.wait_for_selector('#rname'); snap('room-create')
        pg.goto(room); pg.wait_for_selector('#name'); snap('join'); pg.fill('#name', 'Sam'); pg.click('button[type=submit]'); pg.wait_for_selector('.photo.gif'); snap('chat')
        pg.locator('.react-btn').nth(2).tap(); pg.wait_for_selector('.picker'); snap('picker'); pg.keyboard.press('Escape')
        pg.locator('.gif-btn').tap(); pg.wait_for_selector('.gif-pick img'); snap('gifpanel'); pg.locator('.gif-close').tap()
        pg.locator('.photo').first.tap(); pg.wait_for_selector('.lightbox img'); snap('lightbox')
        report[name] = res; ctx.close()
    br.close()
for dev, pages in report.items():
    for pgname, r in pages.items():
        issues = []
        if r['overflow'] > 0: issues.append(f"sideways scroll {r['overflow']}px")
        if r['zoomInputs']: issues.append(f"iOS-zoom inputs {r['zoomInputs']}")
        if r['small']: issues.append(f"small/offscreen: {r['small']}")
        if issues: print(f"{dev:14} {pgname:12} " + ' | '.join(issues))
print('AUDIT DONE')
