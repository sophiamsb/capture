const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 800 });
  const base = 'https://outerwoman.xyz';

  // 5. Hover over first clickable element
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const firstLink = await page.$('a');
  if (firstLink) {
    await firstLink.hover();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: '05_hover_link.png', fullPage: false });
  console.log('✓ 05_hover_link');

  // 6. Scroll to 1/3 of page
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.33));
  await page.waitForTimeout(800);
  await page.screenshot({ path: '06_scroll_third.png', fullPage: false });
  console.log('✓ 06_scroll_third');

  // 7. Scroll to 2/3 of page
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.66));
  await page.waitForTimeout(800);
  await page.screenshot({ path: '07_scroll_twothirds.png', fullPage: false });
  console.log('✓ 07_scroll_twothirds');

  // 8. Hover on a button/CTA if present
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const btn = await page.$('button, [class*="btn"], [class*="cta"]');
  if (btn) {
    await btn.hover();
    await page.waitForTimeout(500);
  } else {
    // hover somewhere mid-page instead
    await page.mouse.move(800, 400);
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: '08_hover_cta.png', fullPage: false });
  console.log('✓ 08_hover_cta');

  await browser.close();
  console.log('Done!');
})();
