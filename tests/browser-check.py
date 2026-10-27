"""
tests/browser-check.py: drives the real page in Chromium (Playwright) and checks that it computes on input.
Run:  python3 tests/browser-check.py
It serves this folder on a free local port, opens index.html, edits the processes and settings, adds and removes
processes, refuses bad input, checks every view, downloads the plan, and fails on any console or page error.
Screenshots go to tests/screenshots/.
"""
import asyncio, functools, http.server, io, pathlib, socketserver, threading, zipfile
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'tests' / 'screenshots'
SHOTS.mkdir(exist_ok=True)
passed = failed = 0


def ok(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print('  PASS', name)
    else:
        failed += 1
        print('  FAIL', name, detail)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


async def until(pg, js, timeout=6000):
    """Polls a JS expression (the page's CSP-free, but this keeps waits explicit and cheap)."""
    for _ in range(timeout // 100):
        if await pg.evaluate(js):
            return True
        await pg.wait_for_timeout(100)
    return False

async def main():
    srv, port = serve()
    base = f'http://127.0.0.1:{port}/index.html'
    errors = []
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        ctx = await br.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
        pg = await ctx.new_page()
        pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errors.append(str(e)))
        k = lambda key: pg.locator(f'.kpi[data-k={key}] b').inner_text()
        approach = lambda pid: pg.locator(f'.opp[data-opp="{pid}"] [data-approach]').get_attribute('data-approach')
        prow = lambda pid: pg.locator(f'.pr[data-row="{pid}"]')

        async def set_field(pid, field, value):
            el = prow(pid).locator(f'[data-f={field}]')
            if await el.evaluate('e => e.tagName') == 'SELECT':
                await el.select_option(str(value))
            else:
                await el.fill(str(value))
            await el.dispatch_event('change')

        print('\n1. The review loads on the invented Perth business')
        await pg.goto(base)
        await pg.wait_for_selector('#opps .opp')
        ok('47 hours a week on these processes, 20.8 back', await k('now') == '47' and await k('saved') == '20.8')
        ok('A$5,490 a month net of 3 Copilot seats; 103 build hours; payback 5 weeks', await k('net') == 'A$5,490' and await k('seats') == '3' and await k('build') == '103' and await k('payback') == '5')
        ok('9 processes ranked, the Xero switch-on first', await pg.locator('#opps .opp').count() == 9 and await pg.locator('#opps .opp').first.get_attribute('data-opp') == 'P9')
        ok('enrolment admin says fix it first; strategy sessions stay human', await approach('P7') == 'fix' and await approach('P8') == 'manual')

        print('\n2. Changing the numbers changes the answer')
        await set_field('P7', 'reworkHours', 0.5)
        await set_field('P7', 'errorRate', 4)
        ok('cutting enrolment rework to 0.5 h turns "fix first" into an automation', await approach('P7') == 'automate')
        ok('and there is one less challenge to raise', await pg.inner_text('#cntPush') == '2')
        await set_field('P7', 'reworkHours', 2)
        await set_field('P7', 'errorRate', 12)
        await pg.fill('#sCop', '60')
        await pg.dispatch_event('#sCop', 'input')
        ok('a A$60 Copilot seat lowers the net to A$5,404', await k('net') == 'A$5,404', await k('net'))
        await pg.fill('#sCop', '31.4')
        await pg.dispatch_event('#sCop', 'input')
        await pg.fill('#sCost', '2')
        await pg.dispatch_event('#sCost', 'input')
        ok('a A$2 staff cost is refused with a reason and the review is kept', 'staffCost must be a number from 10 to 500' in await pg.inner_text('#setErr') and await k('net') == 'A$5,490')
        await pg.fill('#sCost', '90')
        await pg.dispatch_event('#sCost', 'input')
        ok('a A$90 staff cost raises the monthly value', int((await k('net')).replace('A$', '').replace(',', '')) > 5490)
        await pg.fill('#sCost', '62')
        await pg.dispatch_event('#sCost', 'input')
        await set_field('P5', 'judgement', 3)
        ok('setting proposal judgement to 3 keeps proposals human', await approach('P5') == 'manual')
        await set_field('P5', 'judgement', 2)

        print('\n3. Adding and removing processes')
        await pg.click('#aAdd')
        ok('a process with no name is refused with a reason', 'no name' in await pg.inner_text('#addErr'))
        await pg.fill('#aName', 'Weekly SME newsletter')
        await pg.fill('#aOwner', 'Marketing coordinator')
        await pg.fill('#aHours', '3')
        await pg.fill('#aSteps', '5')
        await pg.check('#aClient')
        await pg.click('#aAdd')
        ok('a client-facing newsletter in Microsoft 365 becomes "AI drafts, a person approves"', await approach('N10') == 'draft' and await pg.locator('#opps .opp').count() == 10)
        ok('it shares the Marketing coordinator seat, so seats stay at 3', await k('seats') == '3')
        await prow('N10').locator('[data-del]').click()
        await prow('P2').locator('[data-del]').click()
        ok('removing two processes re-ranks the rest (8 left)', await pg.locator('#opps .opp').count() == 8)

        print('\n4. Plan, push-back and Copilot views')
        await pg.click('.side [data-tab=plan]')
        ok('the plan view shows only the plan', await pg.locator('[data-pane=plan]').is_visible() and not await pg.locator('[data-pane=ranked]').is_visible())
        ok('the Xero switch-on starts in week 1', await pg.locator('.gr[data-plan="P9"]').get_attribute('data-start') == '1')
        before = await pg.inner_text('#cntPlan')
        await pg.fill('#sCap', '20')
        await pg.dispatch_event('#sCap', 'input')
        ok('doubling build capacity shortens the plan', await pg.inner_text('#cntPlan') != before and int((await pg.inner_text('#cntPlan')).rstrip('w')) < int(before.rstrip('w')))
        await pg.click('.side [data-tab=push]')
        ok('push-back cards give the question, evidence, trial, measure and way back', 'Do all 11 steps need to exist?' in await pg.inner_text('#chal') and 'The way back' in await pg.inner_text('#chal'))
        await pg.click('.side [data-tab=copilot]')
        ok('the Copilot view names the seats and where Copilot is not the answer', 'Advisers' in await pg.inner_text('#copBox') and 'copilot is not the answer' in (await pg.inner_text('#copList')).lower())

        print('\n5. Export and reset')
        async with pg.expect_download() as dl:
            await pg.click('#csvBtn')
        d = await dl.value
        text = pathlib.Path(await d.path()).read_text()
        ok('the plan downloads as a CSV with the ranking and the schedule', d.suggested_filename == 'ai-process-plan.csv' and text.startswith('Rank,Process,Owner,Approach') and 'Week from,Week to' in text)
        await pg.click('#resetBtn')
        ok('reset brings back the starting business', await k('net') == 'A$5,490' and await pg.locator('#opps .opp').count() == 9)
        await pg.locator('#tool').scroll_into_view_if_needed()
        await pg.screenshot(path=str(SHOTS / 'desktop-ranked.png'))
        await pg.click('.side [data-tab=plan]')
        await pg.screenshot(path=str(SHOTS / 'desktop-plan.png'))
        await pg.click('.side [data-tab=push]')
        await pg.screenshot(path=str(SHOTS / 'desktop-push.png'))
        await pg.locator('#pricing').scroll_into_view_if_needed()
        await pg.screenshot(path=str(SHOTS / 'desktop-pricing.png'))

        print('\n6. Phone layout')
        mob = await br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        pm = await mob.new_page()
        pm.on('pageerror', lambda e: errors.append(str(e)))
        await pm.goto(base)
        await pm.wait_for_selector('#opps .opp')
        ok('no sideways scrolling at 390px wide', await pm.evaluate('document.documentElement.scrollWidth') <= 390, await pm.evaluate('document.documentElement.scrollWidth'))
        await pm.locator('#opps').scroll_into_view_if_needed()
        await pm.screenshot(path=str(SHOTS / 'mobile.png'))

        ok('zero console or page errors', not errors, errors)
        await br.close()
    srv.shutdown()
    print(f'\n{passed + failed} browser checks: {passed} passed, {failed} failed')
    raise SystemExit(1 if failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
