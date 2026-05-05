const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1600, height: 800 });

  const base = 'https://outerwoman.xyz';

  // 1. Homepage – above the fold
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '01_homepage_top.png', fullPage: false });
  console.log('✓ 01_homepage_top');

  // 2. Scroll mid-page
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(800);
  await page.screenshot({ path: '02_homepage_mid.png', fullPage: false });
  console.log('✓ 02_homepage_mid');

  // 3. Scroll to bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  await page.screenshot({ path: '03_homepage_bottom.png', fullPage: false });
  console.log('✓ 03_homepage_bottom');

  // 4. Full-page hero shot
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '04_homepage_full.png', fullPage: true });
  console.log('✓ 04_homepage_full');

  // Collect all internal links and try to visit a few unique ones
  const links = await page.evaluate(() => {
    const origin = window.location.origin;
    return [...new Set(
      [...document.querySelectorAll('a[href]')]
        .map(a => a.href)
        .filter(h => h.startsWith(origin) && !h.includes('#'))
    )].slice(0, 6);
  });

  console.log('Found links:', links);

  let shot = 5;
  for (const link of links) {
    if (link === base || link === base + '/') continue;
    try {
      await page.goto(link, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1200);
      const slug = link.replace(base, '').replace(/\//g, '_').replace(/^_/, '') || 'page';
      const filename = `${String(shot).padStart(2, '0')}_${slug.slice(0, 40)}.png`;
      await page.screenshot({ path: filename, fullPage: false });
      console.log(`✓ ${filename}`);
      shot++;
    } catch (e) {
      console.log(`⚠ skipped ${link}: ${e.message}`);
    }
  }

  await browser.close();
  console.log('Done!');
})();
