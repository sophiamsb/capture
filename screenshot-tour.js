#!/usr/bin/env node
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
if (!args[0]) {
  console.error('Usage: node screenshot-tour.js <url> [WIDTHxHEIGHT] [output-dir]');
  console.error('  e.g. node screenshot-tour.js https://example.com 1600x800 ./shots');
  process.exit(1);
}

const url = args[0].startsWith('http') ? args[0] : 'https://' + args[0];
const [width, height] = (args[1] || '1600x800').split('x').map(Number);
const outDir = path.resolve(args[2] || './screenshots');

fs.mkdirSync(outDir, { recursive: true });

const hostname = new URL(url).hostname.replace(/\./g, '_');
const timestamp = new Date().toISOString().slice(0, 10);
const prefix = `${hostname}_${timestamp}`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });

  console.log(`\n📸 Capturing ${url} at ${width}x${height}...\n`);

  const save = async (name) => {
    const file = path.join(outDir, `${prefix}_${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log(`  ✓ ${path.basename(file)}`);
  };

  // --- Load page ---
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);

  // 1. Above the fold
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await save('01_top');

  // 2. Full-page
  const fullFile = path.join(outDir, `${prefix}_02_full.png`);
  await page.screenshot({ path: fullFile, fullPage: true });
  console.log(`  ✓ ${path.basename(fullFile)}`);

  // 3–5. Random scroll stops
  const pageHeight = await page.evaluate(() => document.body.scrollHeight);
  const stops = [0.25, 0.5, 0.75];
  for (let i = 0; i < stops.length; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.floor(pageHeight * stops[i]));
    await page.waitForTimeout(600);
    await save(`0${3 + i}_scroll_${Math.round(stops[i] * 100)}pct`);
  }

  // 6. Bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await save('06_bottom');

  // 7. Hover over first link
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const firstLink = await page.$('a');
  if (firstLink) {
    await firstLink.hover().catch(() => {});
    await page.waitForTimeout(500);
  }
  await save('07_hover_link');

  // 8. Hover over first button/CTA
  const btn = await page.$('button, [class*="btn"], [class*="cta"], input[type="submit"]');
  if (btn) {
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.hover().catch(() => {});
    await page.waitForTimeout(500);
  }
  await save('08_hover_cta');

  // 9–N. Visit up to 4 internal links
  const links = await page.evaluate((base) => {
    return [...new Set(
      [...document.querySelectorAll('a[href]')]
        .map(a => a.href)
        .filter(h => h.startsWith(base) && !h.includes('#') && h !== base && h !== base + '/')
    )].slice(0, 4);
  }, new URL(url).origin);

  let shot = 9;
  for (const link of links) {
    try {
      await page.goto(link, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1200);
      const slug = link.replace(new URL(url).origin, '').replace(/\//g, '-').replace(/^-/, '').slice(0, 30) || 'page';
      const file = path.join(outDir, `${prefix}_${String(shot).padStart(2, '0')}_${slug}.png`);
      await page.screenshot({ path: file, fullPage: false });
      console.log(`  ✓ ${path.basename(file)}`);
      shot++;
    } catch {
      console.log(`  ⚠ skipped ${link}`);
    }
  }

  await browser.close();
  console.log(`\n✅ ${shot - 1} screenshots saved to ${outDir}\n`);
})();
