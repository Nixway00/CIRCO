import asyncio, base64, os
from playwright.async_api import async_playwright
async def main():
    os.makedirs('/tmp/article/frames', exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width":1600,"height":900})
        await pg.goto("http://127.0.0.1:8123/frame.html"); await pg.wait_for_function("window.S")
        await pg.evaluate("Promise.all(['800 64px Unbounded','800 46px Unbounded','700 22px Unbounded','400 24px Onest','600 20px Onest','500 16px Onest'].map(f => document.fonts.load(f)))")
        await pg.wait_for_timeout(800)
        total = 600 + 90
        for i in range(0, total, 30):
            ds = await pg.evaluate(f"(() => {{ const out=[]; for (let k={i}; k<Math.min({total},{i}+30); k++) out.push(render(k)); return out; }})()")
            for j, d in enumerate(ds):
                open(f"/tmp/article/frames/f{i+j:04d}.png","wb").write(base64.b64decode(d.split(",")[1]))
        await b.close()
asyncio.run(main())
