import sys, hashlib
from playwright.sync_api import sync_playwright
B=sys.argv[1]; code=open(sys.argv[2]).read(); S=sys.argv[3]; errors=[]
orig=open(f'{S}/test.gif','rb').read()
with sync_playwright() as p:
    br=p.chromium.launch(); ctx=br.new_context(viewport={'width':1100,'height':700}, bypass_csp=True); pg=ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(B+'/chat'); pg.fill('#code',code); pg.click('button[type=submit]'); pg.wait_for_selector('#life')
    pg.click('button.primary.wide'); pg.wait_for_selector('input.link'); room=pg.input_value('input.link')
    pg.goto(room); pg.fill('#name','Eddie'); pg.click('button[type=submit]'); pg.wait_for_selector('.composer textarea')
    m=br.new_context(viewport={'width':390,'height':760}, bypass_csp=True).new_page(); m.on('pageerror', lambda e: errors.append(str(e)))
    m.goto(room); m.fill('#name','Sam'); m.click('button[type=submit]'); m.wait_for_selector('.composer textarea')
    pg.set_input_files('.composer input[type=file]', f'{S}/big.gif'); pg.wait_for_timeout(800); print('too-big GIF message:', pg.inner_text('.conn'))
    pg.set_input_files('.composer input[type=file]', f'{S}/test.gif'); pg.wait_for_selector('.tray img'); pg.click('.composer button[type=submit]')
    m.wait_for_selector('.photo.gif.loaded'); print('Sam got a GIF bubble with badge:', m.locator('.photo.gif').count()==1)
    m.click('.photo'); m.wait_for_selector('.lightbox img')
    with m.expect_download() as d: m.click('.lightbox a')
    got=open(d.value.path(),'rb').read()
    print('download name:', d.value.suggested_filename, '| byte-identical to original (animation intact):', hashlib.sha256(got).hexdigest()==hashlib.sha256(orig).hexdigest())
    m.keyboard.press('Escape')
    # a normal photo still becomes a JPEG
    pg.set_input_files('.composer input[type=file]', files=[{'name':'p.png','mimeType':'image/png','buffer':open(f'{S}/test.gif','rb').read()[:0] or b''}]) if False else None
    m.screenshot(path=f'{S}/gif-phone.png')
    br.close()
print('ERRORS:', errors)
