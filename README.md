# screenshot-tour

Generate a varied set of website screenshots at a custom resolution — great for portfolio mockups.

Captures scroll positions, hover states, and internal page links automatically.

## Requirements

- [Node.js](https://nodejs.org/) v18+

## Setup

```bash
npm install
npm run setup   # downloads Chromium
```

## Usage

```bash
node screenshot-tour.js <url> [WIDTHxHEIGHT] [output-dir]
```

**Examples:**

```bash
# defaults to 1600x800, saves to ./screenshots
node screenshot-tour.js https://example.com

# custom size
node screenshot-tour.js https://example.com 1440x900

# custom size + custom output folder
node screenshot-tour.js https://example.com 1600x800 ./my-shots
```

## Output

Each run produces up to ~12 PNGs named like:

```
example_com_2025-05-04_01_top.png
example_com_2025-05-04_02_full.png
example_com_2025-05-04_03_scroll_25pct.png
...
```

| Screenshot | What it captures |
|---|---|
| `01_top` | Above the fold |
| `02_full` | Full-page tall screenshot |
| `03–05_scroll_*` | 25%, 50%, 75% scroll positions |
| `06_bottom` | Bottom of the page |
| `07_hover_link` | Hovering over the first link |
| `08_hover_cta` | Hovering over a button or CTA |
| `09+` | Up to 4 internal subpages |

## License

MIT
