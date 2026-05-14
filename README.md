# Boston Senior Navigator

A static civic web app that helps elderly residents and caregivers find hospitals, accessible parks, and community resources near any Boston-area address — with real-time MBTA transit routing, live bus/train positions, and turn-by-turn navigation.

**Live site:** https://iknalos.github.io/Boston-senior-navigator

---

## Features

### Resource Discovery
- **Hospitals** — all Boston-area hospitals with click-to-call phone numbers and one-tap directions
- **Accessible Parks** — BPRD parks with wheelchair access, restrooms, seating, and transit proximity
- **311 Hazard Reports** — recent sidewalk, pothole, curb, crosswalk, ice, and snow complaints within 0.5 miles
- **Neighborhood Risk Level** — Climate Ready Boston social vulnerability score (older adults, disability, income, language access)

### Optional Resource Categories (tap chip to enable)
| Category | Source |
|---|---|
| 🏛️ Senior Centers | MassGIS / Councils on Aging |
| 🩺 Community Health Centers | MassGIS / CHC network |
| 🍽️ Community Centers | Boston BCYF |
| 🦷 Dental Clinics | OpenStreetMap (Overpass API) |
| 🧠 Mental Health Services | OpenStreetMap (Overpass API) |
| 🍱 Food Pantries | OpenStreetMap (Overpass API) |
| 🥕 Farmers Markets | OpenStreetMap (Overpass API) |
| ❄️ Cooling / Warming Centers | OpenStreetMap (Overpass API) |

Overpass categories are fetched fresh for each searched location (5-mile radius). Senior Centers, Health Centers, and Community Centers are statewide datasets fetched once and cached for the session.

### Weather Alerts
- NWS API checked on every search — heat, cold, freeze, wind chill, and winter storm alerts shown in a banner at the top of the page

### Routing
- **Walking** — OSRM foot-profile route with step-by-step turn directions and live navigation
- **Driving** — OSRM driving-profile route with turn directions and live navigation
- **Transit** — Train and Bus option cards, each showing:
  - Dotted walking path → nearest T/bus stop (distance + time)
  - Colored transit line with actual MBTA route shape
  - Dotted walking path → destination (distance + time)
  - Total miles, total time, and ETA

### Live MBTA Overlay
- Bus, light rail, and subway vehicles refreshed every 20 seconds
- Colored circle badges with route number/abbreviation
- Filtered to vehicles within 5 miles of the searched location

### Emergency & Senior Service Panels
- **Emergency Contacts** — 911, 211, Poison Control (1-800-222-1222), Elder Abuse Hotline (1-800-922-2275), all click-to-call
- **Age Strong Resources** — links to Age Strong Commission, Meals on Wheels, fuel assistance (MASSCAP), senior legal aid (GBLS), and The RIDE (MBTA paratransit)

### Map
- Leaflet.js with OpenStreetMap tiles
- **Colored circular badge markers** — each category has a distinct solid-color background so every marker is clearly visible against the map
- **Teardrop pin** for Your Location (Google Maps style, anchored at tip)
- **Collapsible Map Key** — tap "🗺 Map Key ▾" in the bottom-left to expand/collapse the legend
- Hover on any result → dashed line drawn from your location to that resource; map fits both points
- Click a result → highlights marker with amber glow and opens directions panel
- Layer control (top-right) to toggle individual categories on/off

### Address Input & Search
- Photon geocoding API with Massachusetts bounding-box bias
- "📍 Use My Location" button via browser Geolocation API
- Search triggers on `Enter` key or by selecting an autocomplete suggestion
- Adjustable search radius (0.5 / 1 / 2 / 3 / 5 miles) — updates results and map circle instantly
- **Share button** — copies a `?lat=&lng=&r=` URL to clipboard so any search can be bookmarked or shared
- **Print button** — print-optimized layout (hides map, prints resource list cleanly)

### Accessibility & Usability
- **Font size toggle** (A+ / A−) in the header — bumps base font from 17px to 20px
- Click-to-call phone links on every resource that has a phone number
- "Google Maps ↗" fallback link for resources where phone data is missing from OpenStreetMap
- All buttons meet 44px minimum touch target
- ARIA labels, `role="button"` on list items, `aria-live` regions for dynamic content

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
| Senior Centers | MassGIS ArcGIS FeatureServer | Statewide Councils on Aging |
| Community Health Centers | MassGIS ArcGIS FeatureServer | Statewide CHC network |
| Community Centers | Boston BCYF ArcGIS | Boston city centers only |
| Dental, Mental Health, Food, Markets, Cooling | [Overpass API](https://overpass-api.de) | Location-specific, 5-mile radius |
| Weather Alerts | [NWS API](https://api.weather.gov) | Heat, cold, winter storm events |
| MBTA Stops, Routes, Shapes, Vehicles | [MBTA V3 API](https://api-v3.mbta.com) | No API key required |
| Walking & Driving Routes | [OSRM Demo Server](https://router.project-osrm.org) | Public, no key required |
| Geocoding | [Photon (Komoot)](https://photon.komoot.io) | OpenStreetMap-based, Massachusetts-biased |

---

## Tech Stack

- **Vanilla JavaScript** (ES5/ES6, IIFE modules) — no build step, no bundler, no framework
- **Leaflet.js 1.9.4** — interactive map, GeoJSON polylines, custom DivIcon badge markers
- **HTML5 / CSS3** — responsive layout with mobile-first breakpoints, elderly-friendly design system
- **GitHub Pages** — static hosting, zero backend

---

## Running Locally

No build step required. Open `index.html` directly in a browser or serve with any static file server:

```bash
# Python
python -m http.server 8080

# Node
npx serve .
```

Then open `http://localhost:8080`.

---

## Project Structure

```
age-friendly-boston/
├── index.html          # Single-page app shell + all HTML panels
├── css/
│   └── style.css       # Design system + all component styles
└── js/
    ├── api.js          # All data fetching (CKAN, MBTA, OSRM, Overpass, NWS, geocoding)
    ├── map.js          # Leaflet map wrapper (markers, routes, legend, live vehicles)
    └── app.js          # UI logic, search flow, routing panels, navigation, chips
```

Scripts load in order (`api.js` → `map.js` → `app.js`) and communicate via `window.BostonAPI` and `window.BostonMap` globals. Static datasets (hospitals, parks, vulnerability) are pre-fetched on page load so they are ready before the user's first search.

---

## Design Principles

- **Elderly-first** — 17px base font (toggleable to 20px), high-contrast navy/amber palette, large touch targets (min 44px), no auto-playing motion
- **Offline-resilient** — every API call has a timeout and fails gracefully with an empty array; the app never crashes on a network error
- **No login, no tracking** — purely static, no cookies, no analytics, no backend
- **Mobile-friendly** — single-column layout on phones, full-width GPS button, collapsible legend, auto-scroll to map after search
- **Accessible** — ARIA labels, keyboard navigation, `aria-live` regions, click-to-call links, screen-reader friendly markup

---

## Deployment

The site is deployed to GitHub Pages. Current version: `v47`. Version badge is shown in the bottom-right corner of the live site.

---

## Acknowledgements

Built for the Age-Friendly Boston initiative. Data provided by the City of Boston Open Data portal ([data.boston.gov](https://data.boston.gov)), MassGIS, the MBTA, and the OpenStreetMap community.
