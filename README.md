# capture

Generate screenshots and videos of any website — scroll tours, single frames, element capture, and guided reels.

Runs a headless Chromium browser locally. Requires Node.js and a one-time browser download.

## Requirements

- [Node.js](https://nodejs.org/) v18+
- ffmpeg (only needed for `--mode reel`) — install with `brew install ffmpeg`

## Setup

```bash
npm install
npm run setup   # downloads Chromium (~170MB, one time)
```

## Start the app

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000), paste a URL, pick a mode and device, hit Capture.

## CLI usage

```bash
node index.js <url> [options]
```

| Option | Default | Description |
|---|---|---|
| `--mode` | `tour` | `tour`, `screenshot`, `video`, `flow`, `reel` |
| `--device` | `desktop` | `desktop`, `laptop`, `tablet`, `mobile`, or `1920x1080` |
| `--full` | — | Full-page screenshot (screenshot mode) |
| `--selector` | — | Capture a specific CSS element |
| `--flow` | — | Path to a flow JSON file (flow / reel mode) |
| `--out` | `./captures` | Output directory |
| `--fps` | `30` | Frame rate (reel mode) |
| `--reel-size` | `1080x1920` | Output video dimensions (reel mode) |

```bash
# scroll tour
node index.js https://example.com

# single full-page screenshot on mobile
node index.js https://example.com --mode screenshot --full --device mobile

# guided reel → mp4
node index.js https://example.com --mode reel --flow my-flow.json
```

## Why it can't run fully online

The tool controls a real browser (Chromium) to load pages, scroll, click, and capture. That browser runs on your machine — it can't run on a static host like Netlify or Vercel. To host it remotely you'd need a server with Node.js and Chromium installed (a VPS, Railway, Render, etc.).

## License

MIT
