# Message sound: counts tones the page starts (each "ding" = 2 tones). Others' messages ding, own don't, bursts give
# one ding, mute silences it and survives a reload, history on join is silent, turning sound on plays a sample.
import sys
from playwright.sync_api import sync_playwright
import _ip  # noqa: F401  (each browser = a different person)
B = sys.argv[1]; code = open(sys.argv[2]).read(); errors = []
COUNT = "window.__tones = 0; const o = AudioContext.prototype.createOscillator; AudioContext.prototype.createOscillator = function () { window.__tones++; return o.call(this); };"
with sync_playwright() as p:
    br = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
    ctx = br.new_context(); ctx.add_init_script(COUNT)
    e = ctx.new_page(); e.on('pageerror', lambda x: errors.append(str(x)))
    e.goto(B + '/chat'); e.wait_for_selector('#rname')
    e.click('button.primary.wide'); e.wait_for_selector('input.link'); room = e.input_value('input.link')
    e.goto(room); e.fill('#name', 'Eddie'); e.click('button[type=submit]'); e.wait_for_selector('.composer textarea')
    s = br.new_context().new_page(); s.goto(room); s.fill('#name', 'Sam'); s.click('button[type=submit]'); s.wait_for_selector('.composer textarea')
    tones = lambda: e.evaluate('window.__tones')
    def say(page, text): page.fill('.composer textarea', text); page.keyboard.press('Enter')
    say(s, 'hi Eddie'); e.wait_for_selector('.row >> text=hi Eddie'); e.wait_for_timeout(300); print("others' message dings:", tones() == 2)
    e.wait_for_timeout(1600); say(e, 'hey'); s.wait_for_selector('.row >> text=hey'); e.wait_for_timeout(300); print('own message is silent:', tones() == 2)
    e.wait_for_timeout(1600); [say(s, f'burst {i}') for i in range(4)]; e.wait_for_selector('.row >> text=burst 3'); e.wait_for_timeout(300); print('burst of 4 gives one ding:', tones() == 4)
    e.click('.icon-only'); print('mute button says:', e.get_attribute('.icon-only', 'aria-label'))
    e.wait_for_timeout(1600); say(s, 'are you there?'); e.wait_for_selector('.row >> text=are you there'); e.wait_for_timeout(300); print('muted = silent:', tones() == 4)
    e.reload(); e.fill('#name', 'Eddie'); e.click('button[type=submit]'); e.wait_for_selector('.row >> text=are you there'); e.wait_for_timeout(500)
    print('mute remembered after reload:', e.get_attribute('.icon-only', 'aria-pressed') == 'false', '| history on join silent:', tones() == 0)
    e.click('.icon-only'); e.wait_for_timeout(300); print('turning sound on plays a sample:', tones() == 2)
    br.close()
print('ERRORS:', errors)
