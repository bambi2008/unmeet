# UnMeet

> Measure the real cost of your meetings. Know which ones to kill.

UnMeet is a Chrome extension that automatically tracks time spent in meetings, calculates the monetary cost, and helps you identify which meetings are worth your time — and which ones aren't.

## What it does

- **Automatic detection** — Detects Google Meet, Zoom, Teams, Feishu, and Tencent Meeting tabs. Zero input required.
- **Cost calculation** — Meeting cost = duration × your hourly rate. See exactly what each meeting costs you.
- **One-tap rating** — Rate meetings 1-5 ⭐ after they end. Build a data-backed case for which meetings to skip.
- **Weekly dashboard** — See how many hours you spent in meetings, average rating, and cost trends.
- **100% local** — All data stored in your browser. No servers, no accounts, no tracking.

## Why

The average knowledge worker spends **31% of meetings in unnecessary ones**. That's ~$399B in global annual waste. Existing tools (Otter, Fireflies, etc.) help you *survive* meetings — UnMeet helps you *have fewer of them*.

## Project Status

🚧 **MVP in development** — Chrome extension beta targeting August 2026.

## Structure

```
unmeet/
├── landing/           # Landing page + waitlist
│   └── index.html
├── extension/         # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js  # Service worker — time tracking engine
│   ├── content.js     # Meeting page detection + rating UI
│   ├── popup.html     # Popup dashboard
│   ├── popup.js
│   ├── options.html   # Settings page
│   ├── options.js
│   └── icons/
└── README.md
```

## Development

```bash
# Load unpacked extension in Chrome:
# 1. Go to chrome://extensions
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the `extension/` directory
```

## License

MIT
