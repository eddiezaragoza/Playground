import sys
from playwright.sync_api import sync_playwright
B=sys.argv[1]; code=open(sys.argv[2]).read(); OUT=sys.argv[3]; errors=[]
with sync_playwright() as p:
    br=p.chromium.launch(); ctx=br.new_context(viewport={'width':1100,'height':700}); pg=ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(B+'/chat'); pg.fill('#code',code); pg.click('button[type=submit]'); pg.wait_for_selector('#life')
    pg.click('button.primary.wide'); pg.wait_for_selector('input.link'); room=pg.input_value('input.link')
    pg.goto(room); pg.fill('#name','Eddie'); pg.click('button[type=submit]'); pg.wait_for_selector('.composer textarea')
    ctx2=br.new_context(viewport={'width':390,'height':760}, has_touch=True, is_mobile=True); m=ctx2.new_page(); m.on('pageerror', lambda e: errors.append(str(e)))
    m.goto(room); m.fill('#name','Sam'); m.click('button[type=submit]'); m.wait_for_selector('.composer textarea')
    pg.fill('.composer textarea','pizza for lunch?'); pg.keyboard.press('Enter')
    m.wait_for_selector('.row .body'); 
    # Sam reacts on phone: tap the smiley, pick 🔥
    m.locator('.react-btn').first.tap(); m.wait_for_selector('.picker'); m.screenshot(path=f'{OUT}/r1-picker-phone.png')
    m.locator('.picker button', has_text='🔥').tap()
    pg.wait_for_selector('.chip >> text=🔥 1'); print('Eddie sees:', pg.inner_text('.chips'))
    # Eddie hovers and reacts 🔥 too, then 👍
    pg.hover('.row'); pg.click('.react-btn'); pg.click('.picker button:has-text("🔥")')
    m.wait_for_selector('.chip >> text=🔥 2'); print('Sam sees:', m.inner_text('.chips').replace('\n',' '), '| tooltip:', m.get_attribute('.chip', 'title'))
    pg.hover('.row'); pg.click('.react-btn'); pg.click('.picker button:has-text("👍")'); pg.wait_for_selector('.chip >> text=👍 1')
    pg.screenshot(path=f'{OUT}/r2-desktop.png')
    # Eddie taps his 🔥 chip to remove his own
    pg.click('.chip.me:has-text("🔥")'); m.wait_for_selector('.chip >> text=🔥 1'); print('after Eddie un-reacts, Sam sees:', m.inner_text('.chips').replace('\n',' '))
    # new joiner sees reactions from history
    n=br.new_context().new_page(); n.goto(room); n.fill('#name','Kim'); n.click('button[type=submit]'); n.wait_for_selector('.chip'); print('Kim (joined later) sees:', n.inner_text('.chips').replace('\n',' '))
    # Escape and outside click close picker
    pg.hover('.row'); pg.click('.react-btn'); pg.wait_for_selector('.picker'); pg.keyboard.press('Escape'); print('Esc closes picker:', pg.locator('.picker').count()==0)
    m.screenshot(path=f'{OUT}/r3-phone.png')
    br.close()
print('ERRORS:', errors)
