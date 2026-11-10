import sys
from playwright.sync_api import sync_playwright
B=sys.argv[1]; code=open(sys.argv[2]).read(); S=sys.argv[3]; errors=[]
with sync_playwright() as p:
    br=p.chromium.launch(); ctx=br.new_context(viewport={'width':1100,'height':560}); pg=ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(B+'/chat'); pg.fill('#code',code); pg.click('button[type=submit]'); pg.wait_for_selector('#rname')
    pg.fill('#rname','Lunch crew'); pg.click('button.primary.wide'); pg.wait_for_selector('input.link'); print('created page:', pg.inner_text('main h1')); room=pg.input_value('input.link')
    g=br.new_context(viewport={'width':390,'height':640}).new_page(); g.on('pageerror', lambda e: errors.append(str(e)))
    g.goto(room); g.wait_for_selector('text=Join "Lunch crew"'); print('guest join page:', g.inner_text('main h1'), '|', g.inner_text('main p.muted'))
    g.fill('#name','Sam'); g.click('button[type=submit]'); g.wait_for_selector('.composer textarea'); g.wait_for_timeout(500)
    print('guest tab title:', g.title(), '| header:', g.inner_text('.chat-head > div').replace('\n',' / '))
    pg.goto(room); pg.fill('#name','Eddie'); pg.click('button[type=submit]'); pg.wait_for_selector('.composer textarea')
    for i in range(14): pg.fill('.composer textarea', f'message {i}'); pg.keyboard.press('Enter')
    g.wait_for_selector('.row >> text=message 13'); g.wait_for_timeout(300)
    g.locator('.react-btn').last.click(); g.click('.picker button:has-text("😂")'); g.wait_for_selector('.chip'); g.wait_for_timeout(300)
    gap=g.evaluate("(() => { const l=document.querySelector('.log'); return l.scrollHeight - l.scrollTop - l.clientHeight; })()") if False else None
    box=g.locator('.row').last.bounding_box(); logbox=g.locator('.log').bounding_box()
    print('last message fully visible after reaction:', box['y']+box['height'] <= logbox['y']+logbox['height']+1)
    g.screenshot(path=f'{S}/name-phone.png')
    pg.once('dialog', lambda d: d.accept('Friday lunch')); pg.click('button:has-text("Rename")')
    g.wait_for_selector('.chat-head strong >> text=Friday lunch'); print('after rename, guest tab title:', g.title())
    print('Rename button shown to guest:', g.locator('button:has-text("Rename")').count()>0)
    br.close()
print('ERRORS:', errors)
