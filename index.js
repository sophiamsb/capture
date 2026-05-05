#!/usr/bin/env node
'use strict';

/**
 * capture — website screenshot & video CLI
 *
 * Usage:
 *   capture <url> [options]
 *
 * Modes:
 *   --mode tour        Multi-shot scroll tour (default)
 *   --mode screenshot  Single screenshot
 *   --mode video       Screen recording (Playwright WebM)
 *   --mode flow        Guided steps from a JSON flow file (screenshots)
 *   --mode reel        Frame-by-frame video from a flow JSON, stitched with ffmpeg
 *
 * Options:
 *   --device <name>    desktop (default), laptop, tablet, mobile, or WIDTHxHEIGHT
 *   --full             Full-page screenshot (screenshot mode)
 *   --selector <css>   Capture a specific element
 *   --flow <file>      Path to flow JSON (flow / reel mode)
 *   --out <dir>        Output directory (default: ./captures)
 *   --format png|jpeg  Image format (default: png)
 *   --fps <n>          Frames per second for reel mode (default: 30)
 *   --reel-size WxH    Output video dimensions for reel (default: 1080x1920)
 *   --no-headless      Show the browser window
 *   --help             Show this help
 */

const { chromium } = require('playwright');
const { execSync }  = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── CLI parsing ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

function opt(long, short, def) {
  for (const key of [long, short].filter(Boolean)) {
    const i = argv.indexOf(key);
    if (i !== -1 && i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
      return argv[i + 1];
    }
  }
  return def;
}

function flag(long, short) {
  return argv.includes(long) || (short && argv.includes(short));
}

if (flag('--help', '-h') || argv.length === 0) {
  console.log(`
  capture <url> [options]

  MODES
    --mode tour        Scroll tour with multiple screenshots (default)
    --mode screenshot  Single screenshot
    --mode video       Record a video while scrolling the page (WebM)
    --mode flow        Execute steps from a JSON flow file (screenshots)
    --mode reel        Frame-by-frame video from a flow JSON → mp4 via ffmpeg

  CAPTURE
    --full             Full-page screenshot (screenshot mode)
    --selector <css>   Capture a specific DOM element
    --flow <file>      Path to flow config JSON (flow / reel mode)

  VIEWPORT
    --device large-desktop  1920×1080
    --device desktop        1440×900  (default)
    --device laptop         1280×800
    --device tablet         768×1024
    --device mobile         390×844
    --device WxH            Custom, e.g. 2560x1440

  OUTPUT
    --out <dir>        Output directory  (default: ./captures)
    --format png       Image format: png or jpeg (default: png)
    --fps <n>          Reel frame rate (default: 30)
    --reel-size WxH    Output video size (default: 1080x1920, vertical story)
    --no-headless      Show the browser window

  REEL FLOW STEPS (--mode reel)
    { "type": "goto",         "url": "https://...", "wait": 2000 }
    { "type": "hold",         "ms": 1200 }                          hold, capture frames
    { "type": "smoothScroll", "pct": 0.5, "duration": 1400 }        ease-scroll to % of page height
    { "type": "smoothScroll", "y": 800,   "duration": 1000 }        ease-scroll to absolute Y
    { "type": "click",        "selector": "nav a[href*=/work]", "wait": 1800 }
    { "type": "wait",         "ms": 500 }                           pause without capturing

  EXAMPLES
    capture https://example.com
    capture https://example.com --mode screenshot --full --device mobile
    capture https://example.com --mode video --device tablet --out ./recordings
    capture https://example.com --mode reel --flow eightfang-flow.json --out ./out
    capture https://example.com --mode flow --flow steps.json
    capture https://example.com --selector ".hero" --out ./hero
`);
  process.exit(0);
}

const url      = argv.find(a => !a.startsWith('-') && (a.startsWith('http') || a.includes('.')));
if (!url) { console.error('Error: URL is required.\nRun capture --help for usage.'); process.exit(1); }

const targetUrl  = url.startsWith('http') ? url : 'https://' + url;
const mode       = opt('--mode', '-m', 'tour');
const deviceArg  = opt('--device', '-d', 'desktop');
const outDir     = path.resolve(opt('--out', '-o', './captures'));
const format     = opt('--format', '-f', 'png');
const flowFile   = opt('--flow', null, null);
const selector   = opt('--selector', '-s', null);
const fullPage   = flag('--full');
const headless   = !flag('--no-headless');
const FPS        = parseInt(opt('--fps', null, '30'), 10);
const reelSizeArg = opt('--reel-size', null, '1080x1920');
const [reelW, reelH] = reelSizeArg.split(/[x×]/i).map(Number);

const DEVICES = {
  'large-desktop': { width: 1920, height: 1080 },
  desktop:         { width: 1440, height: 900 },
  laptop:          { width: 1280, height: 800 },
  tablet:          { width: 768,  height: 1024 },
  mobile:          { width: 390,  height: 844 },
};

function resolveViewport(arg) {
  if (DEVICES[arg]) return DEVICES[arg];
  const m = arg.match(/^(\d+)[x×](\d+)$/i);
  if (m) return { width: parseInt(m[1]), height: parseInt(m[2]) };
  console.warn(`Unknown device "${arg}", falling back to desktop.`);
  return DEVICES.desktop;
}

const viewport = resolveViewport(deviceArg);

// ─── Helpers ──────────────────────────────────────────────────────────────────

fs.mkdirSync(outDir, { recursive: true });

const hostname  = new URL(targetUrl).hostname.replace(/\./g, '_');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const prefix    = `${hostname}_${timestamp}_${deviceArg}`;

let shotIndex = 0;

function nextPath(label, ext) {
  shotIndex++;
  const name = `${prefix}_${String(shotIndex).padStart(2, '0')}_${label}.${ext || format}`;
  return path.join(outDir, name);
}

async function loadPage(page) {
  console.log(`  → Loading ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {}); // some sites never reach networkidle — that's fine
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

async function shot(page, label, opts = {}) {
  const file = nextPath(label);
  const options = { path: file, fullPage: opts.fullPage || false };
  if (opts.selector) {
    const el = await page.$(opts.selector);
    if (!el) { console.warn(`  ⚠ Selector "${opts.selector}" not found, skipping.`); return; }
    await el.screenshot({ path: file });
  } else {
    await page.screenshot(options);
  }
  console.log(`  ✓ ${path.basename(file)}`);
}

// ─── Modes ────────────────────────────────────────────────────────────────────

async function runScreenshot(page) {
  await loadPage(page);
  await shot(page, selector ? 'element' : (fullPage ? 'full' : 'viewport'), {
    fullPage,
    selector,
  });
}

async function runTour(page) {
  await loadPage(page);

  // Above the fold
  await shot(page, 'top');

  // Full page
  const fullFile = nextPath('full');
  await page.screenshot({ path: fullFile, fullPage: true });
  console.log(`  ✓ ${path.basename(fullFile)}`);

  // Scroll stops: 25%, 50%, 75%
  const pageHeight = await page.evaluate(() => document.body.scrollHeight);
  for (const [pct, label] of [[0.25, 'scroll_25pct'], [0.5, 'scroll_50pct'], [0.75, 'scroll_75pct']]) {
    await page.evaluate(y => window.scrollTo(0, y), Math.floor(pageHeight * pct));
    await page.waitForTimeout(600);
    await shot(page, label);
  }

  // Bottom
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  await shot(page, 'bottom');

  // Hover over first interactive elements
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);

  const firstLink = await page.$('a[href]');
  if (firstLink) {
    await firstLink.hover().catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, 'hover_link');
  }

  const firstCta = await page.$('button, [class*="btn"], [class*="cta"], input[type="submit"]');
  if (firstCta) {
    await firstCta.scrollIntoViewIfNeeded().catch(() => {});
    await firstCta.hover().catch(() => {});
    await page.waitForTimeout(400);
    await shot(page, 'hover_cta');
  }

  // Up to 4 internal sub-pages
  const links = await page.evaluate(origin => {
    return [...new Set(
      [...document.querySelectorAll('a[href]')]
        .map(a => a.href)
        .filter(h => h.startsWith(origin) && !h.includes('#') && h !== origin && h !== origin + '/')
    )].slice(0, 4);
  }, new URL(targetUrl).origin);

  for (const link of links) {
    try {
      await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const slug = link.replace(new URL(targetUrl).origin, '').replace(/\//g, '-').replace(/^-/, '').slice(0, 30) || 'page';
      await shot(page, `page_${slug}`);
    } catch {
      console.log(`  ⚠ skipped ${link}`);
    }
  }
}

async function runVideo(context, page) {
  // Video is configured at context level; we just navigate and scroll.
  await loadPage(page);

  const pageHeight = await page.evaluate(() => document.body.scrollHeight);
  const steps = 20;
  const delay = 80;

  console.log('  → Recording scroll…');
  for (let i = 0; i <= steps; i++) {
    const y = Math.floor((pageHeight / steps) * i);
    await page.evaluate(y => window.scrollTo({ top: y, behavior: 'smooth' }), y);
    await page.waitForTimeout(delay);
  }
  await page.waitForTimeout(800);

  // Hover over a CTA before ending
  const cta = await page.$('button, [class*="btn"], [class*="cta"]');
  if (cta) {
    await cta.scrollIntoViewIfNeeded().catch(() => {});
    await cta.hover().catch(() => {});
    await page.waitForTimeout(600);
  }

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

async function runFlow(page) {
  if (!flowFile) {
    console.error('Error: --flow <file> is required for flow mode.');
    process.exit(1);
  }
  const rawFlow = fs.readFileSync(path.resolve(flowFile), 'utf8');
  const steps = JSON.parse(rawFlow);

  console.log(`  → Running flow with ${steps.length} steps…`);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1000);

  for (const step of steps) {
    switch (step.type) {
      case 'goto':
        console.log(`  → goto ${step.url}`);
        await page.goto(step.url.startsWith('http') ? step.url : new URL(step.url, targetUrl).href,
          { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(step.wait || 1000);
        break;
      case 'scroll':
        if (step.selector) {
          const el = await page.$(step.selector);
          if (el) await el.scrollIntoViewIfNeeded();
        } else {
          const y = step.y != null ? step.y : (step.pct != null
            ? Math.floor(await page.evaluate(() => document.body.scrollHeight) * step.pct)
            : 0);
          await page.evaluate(y => window.scrollTo({ top: y, behavior: 'smooth' }), y);
        }
        await page.waitForTimeout(step.wait || 600);
        break;
      case 'click':
        console.log(`  → click ${step.selector}`);
        await page.click(step.selector, { timeout: 8000 }).catch(e => console.warn(`  ⚠ click failed: ${e.message}`));
        await page.waitForTimeout(step.wait || 800);
        break;
      case 'hover':
        console.log(`  → hover ${step.selector}`);
        await page.hover(step.selector, { timeout: 8000 }).catch(e => console.warn(`  ⚠ hover failed: ${e.message}`));
        await page.waitForTimeout(step.wait || 400);
        break;
      case 'fill':
        console.log(`  → fill ${step.selector}`);
        await page.fill(step.selector, step.value || '', { timeout: 8000 })
          .catch(e => console.warn(`  ⚠ fill failed: ${e.message}`));
        await page.waitForTimeout(step.wait || 300);
        break;
      case 'wait':
        await page.waitForTimeout(step.ms || 1000);
        break;
      case 'waitFor':
        console.log(`  → waitFor ${step.selector}`);
        await page.waitForSelector(step.selector, { timeout: step.timeout || 10000 })
          .catch(e => console.warn(`  ⚠ waitFor failed: ${e.message}`));
        break;
      case 'screenshot':
        await shot(page, step.label || 'step', {
          fullPage: step.fullPage || false,
          selector: step.selector || null,
        });
        break;
      default:
        console.warn(`  ⚠ Unknown step type: "${step.type}"`);
    }
  }
}

// ─── Reel mode (frame-by-frame + ffmpeg) ─────────────────────────────────────

async function runReel(page) {
  if (!flowFile) {
    console.error('Error: --flow <file> is required for reel mode.');
    process.exit(1);
  }

  const framesDir = path.join(outDir, `frames_${timestamp}`);
  fs.mkdirSync(framesDir, { recursive: true });

  const steps = JSON.parse(fs.readFileSync(path.resolve(flowFile), 'utf8'));
  const interval = 1000 / FPS;
  let frameIndex = 0;

  async function captureFrame() {
    const p = path.join(framesDir, `frame_${String(frameIndex).padStart(6, '0')}.png`);
    await page.screenshot({ path: p });
    frameIndex++;
  }

  async function captureFrames(ms) {
    const count = Math.floor(ms / interval);
    for (let i = 0; i < count; i++) {
      await captureFrame();
      await page.waitForTimeout(interval);
    }
  }

  async function smoothScroll(targetY, durationMs) {
    const startY = await page.evaluate(() => window.scrollY);
    const count  = Math.floor(durationMs / interval);
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const y = Math.round(startY + (targetY - startY) * eased);
      await page.evaluate(y => window.scrollTo(0, y), y);
      await captureFrame();
      await page.waitForTimeout(interval);
    }
  }

  console.log(`  → Running reel with ${steps.length} steps @ ${FPS}fps…`);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  for (const step of steps) {
    switch (step.type) {
      case 'goto': {
        const dest = step.url.startsWith('http') ? step.url : new URL(step.url, targetUrl).href;
        console.log(`  → goto ${dest}`);
        await page.goto(dest, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(step.wait || 1500);
        break;
      }
      case 'hold':
        await captureFrames(step.ms || 1000);
        break;
      case 'smoothScroll': {
        const pageH = await page.evaluate(() => document.body.scrollHeight);
        const targetY = step.y != null ? step.y : Math.floor(pageH * (step.pct || 0));
        await smoothScroll(targetY, step.duration || 1200);
        break;
      }
      case 'click': {
        console.log(`  → click ${step.selector}`);
        await page.click(step.selector, { timeout: 8000 })
          .catch(e => console.warn(`  ⚠ click failed: ${e.message}`));
        await page.waitForTimeout(step.wait || 800);
        break;
      }
      case 'wait':
        await page.waitForTimeout(step.ms || 500);
        break;
      default:
        console.warn(`  ⚠ Unknown reel step type: "${step.type}"`);
    }
  }

  console.log(`  → ${frameIndex} frames captured. Stitching with ffmpeg…`);

  const outputFile = path.join(outDir, `${prefix}_reel.mp4`);
  execSync(
    `ffmpeg -y -framerate ${FPS} -i "${framesDir}/frame_%06d.png" \
    -vf "scale=${reelW}:-1,pad=${reelW}:${reelH}:0:(oh-ih)/2:black" \
    -c:v libx264 -pix_fmt yuv420p -crf 18 \
    "${outputFile}"`,
    { stdio: 'inherit' }
  );

  // Clean up frames
  fs.rmSync(framesDir, { recursive: true });

  console.log(`  ✓ ${path.basename(outputFile)}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n📸 capture  mode=${mode}  device=${deviceArg} (${viewport.width}×${viewport.height})`);
  console.log(`   url=${targetUrl}`);
  console.log(`   out=${outDir}\n`);

  const isVideo = mode === 'video';

  const videoDir  = isVideo ? outDir : undefined;
  const videoSize = isVideo ? viewport : undefined;

  const browser = await chromium.launch({ headless });

  const contextOptions = {
    viewport,
    ...(isVideo ? {
      recordVideo: {
        dir: videoDir,
        size: videoSize,
      },
    } : {}),
  };

  const context = await browser.newContext(contextOptions);
  const page    = await context.newPage();

  try {
    if (mode === 'tour')       await runTour(page);
    else if (mode === 'video') await runVideo(context, page);
    else if (mode === 'flow')  await runFlow(page);
    else if (mode === 'reel')  await runReel(page);
    else                       await runScreenshot(page);
  } finally {
    await page.close();

    if (isVideo) {
      // Rename the auto-generated video file to a friendly name
      const videoPath = await page.video()?.path().catch(() => null);
      if (videoPath && fs.existsSync(videoPath)) {
        const dest = path.join(outDir, `${prefix}_recording.webm`);
        fs.renameSync(videoPath, dest);
        console.log(`  ✓ ${path.basename(dest)}`);
      } else {
        // Video saved under auto-generated name; list it
        const files = fs.readdirSync(outDir).filter(f => f.endsWith('.webm'));
        if (files.length) console.log(`  ✓ ${files[files.length - 1]}`);
      }
    }

    await context.close();
    await browser.close();

    const saved = fs.readdirSync(outDir).filter(f => f.startsWith(prefix));
    console.log(`\n✅ ${saved.length} file(s) saved to ${outDir}\n`);
  }
})().catch(err => {
  console.error('\n❌', err.message);
  process.exit(1);
});
