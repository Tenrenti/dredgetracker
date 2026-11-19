# Dredger Status Map

Equipment location and status monitoring for DPWH dredging equipment, hosted on GitHub Pages.

**Live page:** https://tenrenti.github.io/dredgetracker/

## How it works

- **The page** (`index.html`) lives here on GitHub Pages.
- **The data** still comes from the Google Sheet through the Apps Script web app. The page asks it for data using the link in `config.js`.
- `bridge.js` lets the original Apps Script dashboard code run here without changes.
- Share links still work, for example `.../dredgetracker/#/regionIII/ae`.

## Files

| File | What it is |
|---|---|
| `index.html` | The dashboard: map, summary, history, and the export add-on with icons |
| `config.js` | The Apps Script `/exec` link |
| `bridge.js` | Connects the page to Apps Script |
| `Code.gs` | Apps Script server code (paste into the Apps Script project) |
| `ExportImages.gs` | Apps Script image-export helper (unchanged) |
| `appsscript.json` | Apps Script manifest (unchanged) |
| `favicon-32.png`, `favicon-48.png` | DPWH logo browser tab icons |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | DPWH logo home-screen app icons |
| `manifest.webmanifest` | App name and icons for "Add to Home Screen" / Install app |

## Updating the Apps Script side

1. Paste `Code.gs` into the Apps Script project and save.
2. Deploy → Manage deployments → ✏️ edit the existing web app → Version: **New version** → Deploy.
   (This keeps the same `/exec` link, so `config.js` does not change.)

The old Apps Script link still opens the original page too.
