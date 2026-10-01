import asyncio
from playwright.async_api import async_playwright
IDS = [('c-cover','00-cover'),('c-stage','01-stage'),('c-fees','02-fees'),('c-round','03-round'),('c-balloons','04-balloons'),('c-fair','05-fair'),('c-extras','07-extras'),('c-tested','08-tested')]
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width":1700,"height":1000})
        await pg.goto("http://127.0.0.1:8123/cards.html"); await pg.evaluate("document.fonts.ready"); await pg.wait_for_timeout(1500)
        for el, name in IDS:
            await pg.locator('#'+el).screenshot(path=f"/tmp/article/out/{name}.png")
        await b.close()
asyncio.run(main())
