# Age-Friendly Boston

A static civic web app that helps elderly residents and caregivers find hospitals, accessible parks, and safety resources near any Boston address — with real-time MBTA transit routing, live bus/train positions, and turn-by-turn navigation.

**Live site:** https://iknalos.github.io/Boston-senior-navigator

---

## Features

### Resource Discovery
- **Hospitals** — all Boston-area hospitals within 2 miles, clickable for directions
- **Accessible Parks** — BPRD parks with wheelchair access, restrooms, seating, and transit proximity within 1 mile
- **311 Hazard Reports** — recent sidewalk, pothole, curb, crosswalk, and snow complaints within 0.5 miles
- **Neighborhood Risk Level** — Climate Ready Boston social vulnerability score (older adults, disability, income, language access)

### Routing
- **Walking** — OSRM foot-profile route with step-by-step turn directions and live navigation
- **Driving** — OSRM driving-profile route with turn directions and live navigation
- **Transit** — separate Train and Bus option cards, each showing:
  - Dotted walking path → nearest T/bus stop (distance + time)
  - Colored transit line with actual MBTA route shape for rail (Red/Orange/Green/Blue Line)
  - Dotted walking path → destination (distance + time)
  - Total miles, total time, and ETA

### Live MBTA Overlay
- Bus, light rail, and subway vehicles refreshed every 20 seconds on the map
- Colored circle badges with route number/abbreviation
- Filtered to vehicles within 5 miles of the searched location

### Map
- Leaflet.js with OpenStreetMap tiles
- Emoji markers for hospitals 🏥, parks 🌿, hazards ⚠️, and home 🏠
- Hover on any result list item → map auto-fits to show both user and destination
- Click a result → highlights marker and opens directions panel
- Layer control to toggle Hospitals, Accessible Parks, 311 Hazards, Your Location, and Live Transit

### Address Input
- Autocomplete against Boston SAM (Street Address Management) dataset — only real Boston addresses
- "Use My Location" button via browser Geolocation API
- Fallback geocoding: US Census Bureau → Nominatim (OpenStreetMap)

---

## Data Sources

| Dataset | Source | Notes |
|---|---|---|
| Hospitals | [Analyze Boston](https://data.boston.gov) | Resource ID `9ce5935a` |
| Accessible Park Entrances | Analyze Boston | Resource ID `2705f51f` |
| Accessible Park Details | Analyze Boston | Resource ID `5dbfc0b1` |
| 311 Requests 2024–2026 | Analyze Boston | Filtered to fall/navigation hazard keywords |
| Social Vulnerability | Analyze Boston | Climate Ready Boston composite score |
| SAM Addresses (autocomplete) | Analyze Boston | Resource ID `6d6cfc99` |
| MBTA Stops, Routes, Shapes, Vehicles | [MBTA V3 API](https://api-v3.mbta.com) | No API key required |
| Walking & Driving Routes | [OSRM Demo Server](https://router.project-osrm.org) | Public, no key required |
| Geocoding | US Census Bureau + Nominatim | Free, no key required |

---

## Tech Stack

- **Vanilla JavaScript** (ES5/ES6, IIFE modules) — no build step, no bundler
- **Leaflet.js 1.9.4** — interactive map, GeoJSON polylines, DivIcon emoji markers
- **HTML5 / CSS3** — responsive two-column layout, elderly-friendly design (large text, high contrast, large tap targets)
- **GitHub Pages** — static hosting, zero backend

---

## Running Locally

No build step required. Just open `index.html` in a browser, or use any static file server:

```bash
# Python
python -m http.server 8080

# Node (npx)
npx serve .
```

Then open `http://localhost:8080`.

---

## Project Structure

```
age-friendly-boston/
├── index.html          # Single-page app shell
├── css/
│   └── style.css       # Design system + all component styles
└── js/
    ├── api.js          # All data fetching (CKAN, MBTA, OSRM, geocoding)
    ├── map.js          # Leaflet map wrapper (markers, routes, live vehicles)
    └── app.js          # UI logic, search, routing panels, navigation
```

Scripts load in order (`api.js` → `map.js` → `app.js`) and communicate via `window.BostonAPI` and `window.BostonMap` globals.

---

## Design Principles

- **Elderly-first** — 17px base font, high contrast navy/amber palette, large touch targets (min 44px), no auto-playing motion
- **Offline-resilient** — all API calls fail gracefully and return empty arrays; the app never crashes on a network error
- **No login, no tracking** — purely static, no cookies, no analytics
- **Accessible** — ARIA labels, `role="button"` on interactive list items, `aria-live` regions for dynamic content

---

## Deployment

The site deploys automatically to GitHub Pages on every push to `main`. Version is tracked in the bottom-right corner of the page (e.g. `v26`).

To deploy manually:
```bash
git push origin main
```

The site will be available at `https://iknalos.github.io/Boston-senior-navigator` after GitHub Pages rebuilds (usually within 60 seconds).

---

## Acknowledgements

Built for the Age-Friendly Boston initiative. Data provided by the City of Boston Open Data portal ([data.boston.gov](https://data.boston.gov)) and the MBTA.
