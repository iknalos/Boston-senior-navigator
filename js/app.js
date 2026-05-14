(function () {
  'use strict';

  // ── DOM references ────────────────────────────────────────────
  const searchBtn      = document.getElementById('search-btn');
  const locateBtn      = document.getElementById('locate-btn');
  const searchInput    = document.getElementById('address-input');
  const loadingOverlay = document.getElementById('loading-overlay');
  const resultsAddress = document.getElementById('results-address');
  const hospitalCount  = document.getElementById('hosp-count');
  const parkCount      = document.getElementById('parks-count');
  const hazardCount    = document.getElementById('hazards-count');
  const seniorsCount   = document.getElementById('seniors-count');
  const healthCount    = document.getElementById('health-count');
  const communityCount = document.getElementById('community-count');
  const vulnBadge      = document.getElementById('vuln-badge');
  const suggestionsList = document.getElementById('address-suggestions');
  const hospList       = document.getElementById('hosp-list');
  const parksList      = document.getElementById('parks-list');
  const hazardsList    = document.getElementById('hazards-list');
  const seniorsList    = document.getElementById('seniors-list');
  const healthList     = document.getElementById('health-list');
  const communityList  = document.getElementById('community-list');
  const dentalCount    = document.getElementById('dental-count');
  const mentalCount    = document.getElementById('mental-count');
  const foodCount      = document.getElementById('food-count');
  const marketsCount   = document.getElementById('markets-count');
  const coolingCount   = document.getElementById('cooling-count');
  const dentalList     = document.getElementById('dental-list');
  const mentalList     = document.getElementById('mental-list');
  const foodList       = document.getElementById('food-list');
  const marketsList    = document.getElementById('markets-list');
  const coolingList    = document.getElementById('cooling-list');

  const resultsPanel       = document.getElementById('results-panel');
  const directionsPanel    = document.getElementById('directions-panel');
  const routePanel         = document.getElementById('route-panel');

  const directionsBackBtn  = document.getElementById('directions-back-btn');
  const directionsName     = document.getElementById('directions-name');
  const directionsAddr     = document.getElementById('directions-addr');
  const directionsTime     = document.getElementById('directions-time');
  const directionsWalkBtn  = document.getElementById('directions-walk-btn');
  const directionsCarBtn   = document.getElementById('directions-car-btn');
  const directionsTransitBtn = document.getElementById('directions-transit-btn');
  const mbtaStopsList      = document.getElementById('mbta-stops-list');

  const routeBackBtn    = document.getElementById('route-back-btn');
  const routeModeLabel  = document.getElementById('route-mode-label');
  const routeSummary    = document.getElementById('route-summary');
  const routeSteps      = document.getElementById('route-steps');
  const navBar          = document.getElementById('nav-bar');
  const navStartBtn     = document.getElementById('nav-start-btn');
  const navStopBtn      = document.getElementById('nav-stop-btn');
  const navEtaTime      = document.getElementById('nav-eta-time');
  const navEtaDist      = document.getElementById('nav-eta-dist');

  // ── App state ─────────────────────────────────────────────────
  let map = null;
  let allHospitals = [], allParks = [], allVulnerability = [];
  let allSeniorCenters = [], allHealthCenters = [], allCommunityCenters = [];
  let allDentalClinics = [], allMentalHealth = [], allFoodPantries = [], allFarmersMarkets = [], allCoolingCenters = [];
  let autocompleteTimer = null, selectedSuggestion = null;
  let currentLocation = null;
  let currentDest = null;
  let searchRadius = 1;          // miles — driven by radius selector
  let _lastHazards = [];         // cached so radius change re-renders without re-fetching
  let _enabledOptionals = new Set(); // which optional category chips are on

  // Navigation state
  let navWatchId     = null;
  let navMode        = 'walk';     // 'walk' | 'car' | 'transit'
  let navRouteCoords = [];         // GeoJSON [lng, lat] pairs for progress tracking
  let navDestLat     = null;
  let navDestLng     = null;
  let navActive      = false;

  // Live transit vehicle refresh
  let _transitRefreshId   = null;
  let _activeTransitRouteId = null; // set when user picks a specific transit card

  // Speed estimates (mph) per mode
  const NAV_SPEED = { walk: 3, car: 25, transit: 3 };

  // ── Helpers ───────────────────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatDist(miles) {
    return miles < 0.1
      ? (miles * 5280).toFixed(0) + ' ft'
      : miles.toFixed(1) + ' mi';
  }

  function formatMeters(m) {
    return m < 160 ? Math.round(m) + ' m' : (m / 1609.34).toFixed(1) + ' mi';
  }

  function formatSeconds(s) {
    const mins = Math.round(s / 60);
    if (mins < 60) return mins + ' min';
    const h = Math.floor(mins / 60), mm = mins % 60;
    return h + ' h' + (mm ? ' ' + mm + ' min' : '');
  }

  function walkingTime(miles) {
    const mins = Math.round(miles * 1.3 / 3 * 60);
    if (mins < 60) return '~' + mins + ' min walk';
    return '~' + Math.floor(mins/60) + ' h ' + (mins % 60 ? mins%60+' min ' : '') + 'walk';
  }

  function dist(lat1, lng1, lat2, lng2) {
    const R = 3958.8, dL = (lat2-lat1)*Math.PI/180, dG = (lng2-lng1)*Math.PI/180;
    const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  function filterByRadius(items, lat, lng, miles) {
    return items.filter(item => {
      const ilat = parseFloat(item.lat), ilng = parseFloat(item.lng);
      return !isNaN(ilat) && !isNaN(ilng) && dist(lat, lng, ilat, ilng) <= miles;
    });
  }

  function medianVulnScore() {
    const s = allVulnerability.map(r => r.vulnerability_score).filter(v => v != null);
    if (!s.length) return null;
    s.sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  // ── Live transit refresh ──────────────────────────────────────
  async function _fetchAndPlotVehicles() {
    if (!currentLocation || !map) return;
    let vehicles;
    if (_activeTransitRouteId) {
      // Route is selected: fetch only that route's vehicles (whole system, no radius filter)
      vehicles = await BostonAPI.fetchMBTAVehicles(_activeTransitRouteId);
    } else {
      // General mode: all types within 5 miles
      vehicles = await BostonAPI.fetchMBTAVehicles();
      vehicles = vehicles.filter(function (v) {
        return dist(currentLocation.lat, currentLocation.lng, v.lat, v.lng) <= 5;
      });
    }
    if (!map || !currentLocation) return;
    BostonMap.plotTransitVehicles(vehicles, !!_activeTransitRouteId);
  }

  function _startTransitRefresh(intervalMs) {
    _stopTransitRefresh();
    _fetchAndPlotVehicles();
    _transitRefreshId = setInterval(_fetchAndPlotVehicles, intervalMs || 20000);
  }

  function _clearActiveRoute() {
    if (_activeTransitRouteId) {
      _activeTransitRouteId = null;
      _startTransitRefresh(20000);
    }
  }

  function _stopTransitRefresh() {
    if (_transitRefreshId !== null) {
      clearInterval(_transitRefreshId);
      _transitRefreshId = null;
    }
  }

  // ── Panel helper ──────────────────────────────────────────────
  function showPanel(which) {
    resultsPanel.setAttribute('hidden', '');
    directionsPanel.setAttribute('hidden', '');
    routePanel.setAttribute('hidden', '');
    which.removeAttribute('hidden');
  }

  // ── Loading overlay ───────────────────────────────────────────
  function showLoading() { loadingOverlay.removeAttribute('hidden'); }
  function hideLoading()  { loadingOverlay.setAttribute('hidden', ''); }

  // ── Vulnerability badge ───────────────────────────────────────
  function setVulnerabilityBadge(score) {
    let label, cls;
    if (score == null)   { label = 'Unknown';     cls = 'unknown'; }
    else if (score < 33) { label = 'Low Risk';    cls = 'low';     }
    else if (score < 66) { label = 'Medium Risk'; cls = 'medium';  }
    else                 { label = 'High Risk';   cls = 'high';    }
    vulnBadge.textContent = label;
    vulnBadge.className   = 'vuln-badge vuln-badge--' + cls;
  }

  // ── Autocomplete ──────────────────────────────────────────────
  function hideSuggestions() {
    suggestionsList.setAttribute('hidden', '');
    suggestionsList.innerHTML = '';
  }

  function showSuggestions(results) {
    suggestionsList.innerHTML = '';
    if (!results.length) { hideSuggestions(); return; }
    results.forEach(function (r) {
      const li = document.createElement('li');
      const cityLine = [r.city, r.state, r.zip].filter(Boolean).join(', ');
      li.innerHTML =
        '<span class="sugg-icon" aria-hidden="true">&#128205;</span>' +
        '<span class="sugg-text">' +
          '<span class="sugg-street">' + _esc(r.street || r.label) + '</span>' +
          (cityLine ? '<span class="sugg-city">' + _esc(cityLine) + '</span>' : '') +
        '</span>';
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        searchInput.value = r.label;
        selectedSuggestion = { lat: r.lat, lng: r.lng };
        hideSuggestions();
        runSearch(selectedSuggestion, r.label);
      });
      suggestionsList.appendChild(li);
    });
    suggestionsList.removeAttribute('hidden');
  }

  searchInput.addEventListener('input', function () {
    selectedSuggestion = null;
    clearTimeout(autocompleteTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) { hideSuggestions(); return; }
    autocompleteTimer = setTimeout(function () {
      BostonAPI.searchAddresses(q).then(showSuggestions);
    }, 250);
  });

  searchInput.addEventListener('blur', function () {
    setTimeout(hideSuggestions, 150);
  });

  // ── Directions panel ──────────────────────────────────────────
  function showDirectionsPanel(item, distMiles) {
    currentDest = item;
    directionsName.textContent = item.name    || 'Destination';
    directionsAddr.textContent = item.address || '';
    directionsTime.textContent = walkingTime(distMiles);
    showPanel(directionsPanel);
    if (map) { BostonMap.clearHoverLine(); BostonMap.flyToLocation(item.lat, item.lng); }
    mbtaStopsList.innerHTML = '<p class="mbta-loading">Loading transit info&hellip;</p>';
    loadMBTAStops(item.lat, item.lng);
  }

  async function loadMBTAStops(lat, lng) {
    try {
      const stops = await BostonAPI.fetchMBTANearbyStops(lat, lng);
      if (!stops.length) {
        mbtaStopsList.innerHTML = '<p class="mbta-no-stops">No MBTA stops within 0.5 miles.</p>';
        return;
      }
      const predArrays = await Promise.all(stops.map(s => BostonAPI.fetchMBTAPredictions(s.id)));
      mbtaStopsList.innerHTML = '';
      stops.forEach(function (stop, i) {
        const preds = predArrays[i];
        const div = document.createElement('div');
        div.className = 'mbta-stop';
        let html = '<span class="mbta-stop__name">' + _esc(stop.name) + '</span>'
                 + '<span class="mbta-stop__dist">(' + formatDist(stop.distance) + ')</span>';
        if (!preds.length) {
          html += '<div class="mbta-arrival"><span class="mbta-arrival__time">No upcoming arrivals</span></div>';
        } else {
          preds.forEach(function (p) {
            const t = p.minutesAway <= 1 ? 'Now' : p.minutesAway + ' min (' + p.departureTime + ')';
            html += '<div class="mbta-arrival"><span class="mbta-arrival__route">' + _esc(p.routeName)
                  + '</span><span class="mbta-arrival__time">' + t + '</span></div>';
          });
        }
        div.innerHTML = html;
        mbtaStopsList.appendChild(div);
      });
    } catch (err) {
      mbtaStopsList.innerHTML = '<p class="mbta-no-stops">Could not load transit info.</p>';
    }
  }

  // ── Route panel helpers ───────────────────────────────────────
  function openRoutePanel(modeLabel) {
    showPanel(routePanel);
    routeModeLabel.textContent = modeLabel;
    routeSummary.textContent   = 'Loading route…';
    routeSteps.innerHTML = '';
    navBar.setAttribute('hidden', '');
    navStartBtn.removeAttribute('hidden');
    navStartBtn.disabled = true;
    navRouteCoords = [];
    if (map) BostonMap.clearRoute();
  }

  function onRouteReady() {
    navStartBtn.disabled = false;
  }

  // ── Walking route ─────────────────────────────────────────────
  async function showWalkingRoute() {
    if (!currentLocation || !currentDest) return;
    navMode = 'walk';
    navDestLat = currentDest.lat;
    navDestLng = currentDest.lng;
    openRoutePanel('🚶 Walking Route');

    const route = await BostonAPI.fetchOSRMRoute(
      currentLocation.lat, currentLocation.lng,
      currentDest.lat, currentDest.lng, 'foot'
    );

    if (!route) { routeSummary.textContent = 'Could not load route. Try again.'; return; }

    navRouteCoords = route.geometry.coordinates;
    if (map) { BostonMap.drawRoute(route.geometry, '#1a5c3a', false); BostonMap.fitRoutes(); }

    routeSummary.innerHTML =
      '<strong>' + (route.distance / 1609.34).toFixed(1) + ' mi</strong>'
      + ' &nbsp;·&nbsp; ~' + formatSeconds(route.duration);

    renderSteps(route.steps);
    onRouteReady();
  }

  // ── Driving route ─────────────────────────────────────────────
  async function showDrivingRoute() {
    if (!currentLocation || !currentDest) return;
    navMode = 'car';
    navDestLat = currentDest.lat;
    navDestLng = currentDest.lng;
    openRoutePanel('🚗 Driving Route');

    const route = await BostonAPI.fetchOSRMRoute(
      currentLocation.lat, currentLocation.lng,
      currentDest.lat, currentDest.lng, 'driving'
    );

    if (!route) { routeSummary.textContent = 'Could not load route. Try again.'; return; }

    navRouteCoords = route.geometry.coordinates;
    if (map) { BostonMap.drawRoute(route.geometry, '#1565c0', false); BostonMap.fitRoutes(); }

    routeSummary.innerHTML =
      '<strong>' + (route.distance / 1609.34).toFixed(1) + ' mi</strong>'
      + ' &nbsp;·&nbsp; ~' + formatSeconds(route.duration);

    renderSteps(route.steps);
    onRouteReady();
  }

  // ── Transit route — pick Train or Bus, then draw full path ────────
  const ROUTE_TYPE_ICON  = { 0:'🚋', 1:'🚇', 2:'🚂', 3:'🚌', 4:'⛴️' };
  const TRANSIT_SPEED_MPH = { 0:15, 1:22, 2:35, 3:10, 4:18 };

  // Phase 1: show Train and Bus cards
  async function showTransitRoute() {
    if (!currentLocation || !currentDest) return;
    navMode = 'transit';
    navDestLat = currentDest.lat;
    navDestLng = currentDest.lng;

    showPanel(routePanel);
    routeModeLabel.textContent = '🚌 Transit Options';
    routeSummary.innerHTML = '<div class="transit-total">Finding train &amp; bus options…</div>';
    routeSteps.innerHTML   = '';
    navBar.setAttribute('hidden', '');
    navStartBtn.setAttribute('hidden', '');
    navRouteCoords = [];
    if (map) BostonMap.clearRoute();

    let cards = [];
    try { cards = await _fetchTransitCards(); } catch (e) { console.error('transit cards error:', e); }

    if (!cards.length) {
      routeSummary.innerHTML = '<div class="transit-total">No transit nearby</div>';
      routeSteps.innerHTML   = '<p class="transit-no-routes">No MBTA stops found within 1 mile of these locations. Try a closer destination or check the MBTA app.</p>';
      return;
    }

    routeSummary.innerHTML = '<div class="transit-total">Choose your mode</div>';
    routeSteps.innerHTML   = '';

    cards.forEach(function (opt) {
      const card = document.createElement('div');
      card.className = 'transit-option-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      const isRail  = opt.type === 'train';
      const modeIcon = isRail ? '🚇' : '🚌';
      const modeLabel = isRail ? 'Train' : 'Bus';
      const bg       = opt.route.color && opt.route.color !== '000000' ? '#' + opt.route.color : '#1a3a5c';
      const depText  = opt.nextDepartureMins !== null
        ? (opt.nextDepartureMins <= 1 ? 'Now' : 'in ' + opt.nextDepartureMins + ' min')
        : '—';

      card.innerHTML =
        '<div class="toc-header">'
        + '<span class="toc-mode-icon">' + modeIcon + '</span>'
        + '<span class="toc-mode-label">' + modeLabel + '</span>'
        + '<span class="toc-badge" style="background:' + bg + '">' + _esc(opt.route.name) + '</span>'
        + '<span class="toc-dep" style="margin-left:auto">Next: ' + depText + '</span>'
        + '</div>'
        + '<div class="toc-route-detail">'
        + '🚶 <strong>' + opt.walkToMins + ' min</strong> → '
        + _esc(opt.oStop.name)
        + ' → ' + modeIcon + ' <strong>' + opt.transitMins + ' min</strong> → '
        + _esc(opt.dStop.name)
        + (opt.walkFromMins > 0 ? ' → 🚶 <strong>' + opt.walkFromMins + ' min</strong>' : '')
        + '</div>'
        + '<div class="toc-row"><span class="toc-total">~' + opt.estimatedTotalMins + ' min total</span></div>';

      function go() { _planSelectedTransit(opt); }
      card.addEventListener('click', go);
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      routeSteps.appendChild(card);
    });
  }

  // Build one Train card and one Bus card by filtering stops by route type.
  // This avoids the "common routes" problem — we just find the nearest stop
  // of each type on both ends independently.
  async function _fetchTransitCards() {
    const fl = currentLocation.lat, fg = currentLocation.lng;
    const tl = currentDest.lat,     tg = currentDest.lng;

    // Fetch train stops (types 0=light rail, 1=subway) and bus stops (type 3) near both ends
    const [trainO, trainD, busO, busD] = await Promise.all([
      BostonAPI.fetchNearbyStopsByType(fl, fg, '0,1', 0.015),  // subway within 1 mi of origin
      BostonAPI.fetchNearbyStopsByType(tl, tg, '0,1', 0.015),  // subway within 1 mi of dest
      BostonAPI.fetchNearbyStopsByType(fl, fg, '3',   0.0072), // bus within 0.5 mi of origin
      BostonAPI.fetchNearbyStopsByType(tl, tg, '3',   0.0072), // bus within 0.5 mi of dest
    ]);

    const cards = [];

    // Train card
    if (trainO.length && trainD.length) {
      const oStop = trainO[0];
      const dStop = trainD[0];
      const [routes, preds] = await Promise.all([
        BostonAPI.fetchMBTARoutesForStop(oStop.id),
        BostonAPI.fetchMBTAPredictions(oStop.id),
      ]);
      const subRoutes = routes.filter(function (r) { return r.type === 0 || r.type === 1; });
      const route = subRoutes[0] || routes[0] || { id:'T', name:'T', longName:'Train', type:1, color:'1a3a5c' };
      const filtPreds = preds.filter(function (p) { return p.routeId === route.id; });

      const walkToMins   = Math.max(1, Math.round(oStop.distance / 3 * 60));
      const walkFromMins = Math.max(0, Math.round(dist(dStop.lat, dStop.lng, tl, tg) / 3 * 60));
      const transitDist  = dist(oStop.lat, oStop.lng, dStop.lat, dStop.lng);
      const transitMins  = Math.max(1, Math.round(transitDist / (TRANSIT_SPEED_MPH[route.type] || 15) * 60));
      const nextDep      = filtPreds.length > 0 ? Math.max(0, filtPreds[0].minutesAway) : null;
      const waitMins     = nextDep !== null ? nextDep : 5;

      cards.push({ type:'train', route, oStop, dStop,
        walkToMins, transitMins, walkFromMins, waitMins,
        nextDepartureMins: nextDep, allPreds: filtPreds,
        estimatedTotalMins: walkToMins + waitMins + transitMins + walkFromMins });
    }

    // Bus card
    if (busO.length && busD.length) {
      const oStop = busO[0];
      const dStop = busD[0];
      const [routes, preds] = await Promise.all([
        BostonAPI.fetchMBTARoutesForStop(oStop.id),
        BostonAPI.fetchMBTAPredictions(oStop.id),
      ]);
      const busRoutes = routes.filter(function (r) { return r.type === 3; });
      const route = busRoutes[0] || routes[0] || { id:'bus', name:'Bus', longName:'Bus', type:3, color:'1a3a5c' };
      const filtPreds = preds.filter(function (p) { return p.routeId === route.id; });

      const walkToMins   = Math.max(1, Math.round(oStop.distance / 3 * 60));
      const walkFromMins = Math.max(0, Math.round(dist(dStop.lat, dStop.lng, tl, tg) / 3 * 60));
      const transitDist  = dist(oStop.lat, oStop.lng, dStop.lat, dStop.lng);
      const transitMins  = Math.max(1, Math.round(transitDist / 10 * 60));
      const nextDep      = filtPreds.length > 0 ? Math.max(0, filtPreds[0].minutesAway) : null;
      const waitMins     = nextDep !== null ? nextDep : 5;

      cards.push({ type:'bus', route, oStop, dStop,
        walkToMins, transitMins, walkFromMins, waitMins,
        nextDepartureMins: nextDep, allPreds: filtPreds,
        estimatedTotalMins: walkToMins + waitMins + transitMins + walkFromMins });
    }

    return cards;
  }

  // Phase 2: plan and draw the full route for a selected option
  async function _planSelectedTransit(opt) {
    routeSummary.innerHTML = '<div class="transit-total">Planning route…</div>';
    routeSteps.innerHTML   = '';
    if (map) BostonMap.clearRoute();

    // Switch to route-specific live tracking at 5s refresh
    _activeTransitRouteId = opt.route.id;
    _startTransitRefresh(5000);

    // Rail (0,1,2): use actual MBTA shape; Bus (3): use OSRM driving along roads
    const isRail = opt.route.type === 0 || opt.route.type === 1 || opt.route.type === 2;
    const [walkToStop, walkFromStop, mbtaShape, busOSRM] = await Promise.all([
      BostonAPI.fetchOSRMRoute(currentLocation.lat, currentLocation.lng, opt.oStop.lat, opt.oStop.lng),
      BostonAPI.fetchOSRMRoute(opt.dStop.lat, opt.dStop.lng, currentDest.lat, currentDest.lng),
      isRail  ? BostonAPI.fetchMBTARouteShape(opt.route.id, opt.oStop.lat, opt.oStop.lng, opt.dStop.lat, opt.dStop.lng) : Promise.resolve(null),
      !isRail ? BostonAPI.fetchOSRMRoute(opt.oStop.lat, opt.oStop.lng, opt.dStop.lat, opt.dStop.lng, 'driving')        : Promise.resolve(null),
    ]);

    // Best available transit geometry: MBTA shape → OSRM → straight line fallback
    const transitGeom = mbtaShape
      || (busOSRM ? busOSRM.geometry : null)
      || { type: 'LineString', coordinates: [[opt.oStop.lng, opt.oStop.lat], [opt.dStop.lng, opt.dStop.lat]] };
    const transitRoute = busOSRM || null;

    const transitColor = opt.route.color && opt.route.color !== '000000' ? '#' + opt.route.color : '#1565c0';
    const icon         = ROUTE_TYPE_ICON[opt.route.type] || '🚌';
    const bg           = opt.route.color && opt.route.color !== '000000' ? '#' + opt.route.color : '#1a3a5c';

    // Draw on map
    if (map) {
      if (walkToStop) BostonMap.drawRoute(walkToStop.geometry, '#1a5c3a', true);
      BostonMap.drawRoute(transitGeom, transitColor, false);
      if (walkFromStop) BostonMap.drawRoute(walkFromStop.geometry, '#1a5c3a', true);
      BostonMap.fitRoutes();
    }

    // Build combined coords for ETA tracking
    const allCoords = [];
    if (walkToStop)  allCoords.push(...walkToStop.geometry.coordinates);
    allCoords.push(...transitGeom.coordinates);
    if (walkFromStop) allCoords.push(...walkFromStop.geometry.coordinates);
    navRouteCoords = allCoords;

    // Times and distances
    const wt  = walkToStop   ? Math.round(walkToStop.duration  / 60) : opt.walkToMins;
    const wf  = walkFromStop ? Math.round(walkFromStop.duration / 60) : opt.walkFromMins;
    const wa  = opt.nextDepartureMins !== null ? opt.nextDepartureMins : 5;
    const tr  = opt.transitMins;
    const tot = wt + wa + tr + wf;

    const walkToDist    = walkToStop   ? walkToStop.distance  / 1609.34 : opt.oStop.distance;
    const walkFromDist  = walkFromStop ? walkFromStop.distance / 1609.34 : dist(opt.dStop.lat, opt.dStop.lng, tl, tg);
    const transitDistMi = dist(opt.oStop.lat, opt.oStop.lng, opt.dStop.lat, opt.dStop.lng);
    const totalMi       = (walkToDist + transitDistMi + walkFromDist).toFixed(1);
    const eta           = new Date(Date.now() + tot * 60000).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

    routeSummary.innerHTML =
      '<div class="transit-total">~' + tot + ' min · ' + totalMi + ' mi · ETA ' + eta + '</div>'
      + '<div class="transit-breakdown">'
      + '<span class="tb-seg tb-walk">🚶 ' + wt + ' min</span>'
      + '<span class="tb-arrow">→</span>'
      + '<span class="tb-seg tb-wait">⏱ ' + wa + ' min</span>'
      + '<span class="tb-arrow">→</span>'
      + '<span class="tb-seg tb-transit">' + icon + ' ' + tr + ' min</span>'
      + (wf ? '<span class="tb-arrow">→</span><span class="tb-seg tb-walk">🚶 ' + wf + ' min</span>' : '')
      + '</div>';

    routeSteps.innerHTML = '';

    // Walk to stop
    const s1 = document.createElement('div');
    s1.className = 'transit-segment transit-segment--walk';
    s1.innerHTML = '<div class="transit-seg__header">🚶 Walk to <strong>' + _esc(opt.oStop.name) + '</strong></div>'
      + '<div class="transit-seg__detail">'
      + (walkToStop
          ? formatMeters(walkToStop.distance) + ' · ~' + Math.round(walkToStop.duration / 60) + ' min'
          : walkToDist.toFixed(2) + ' mi · ~' + wt + ' min')
      + '</div>';
    routeSteps.appendChild(s1);

    // Transit segment
    const s2 = document.createElement('div');
    s2.className = 'transit-segment transit-segment--bus';
    let s2Html = '<div class="transit-seg__header">'
      + '<span class="transit-route-badge" style="background:' + bg + '">' + _esc(opt.route.name) + '</span> '
      + icon + ' <strong>' + _esc(opt.route.longName || opt.route.name) + '</strong>'
      + '</div>';
    if (opt.allPreds && opt.allPreds.length) {
      s2Html += '<div class="transit-seg__preds"><strong>Next:</strong> '
        + opt.allPreds.slice(0, 4).map(function (p) {
            return p.minutesAway <= 1 ? '<span class="pred-now">Now</span>' : p.minutesAway + ' min';
          }).join(' · ')
        + '</div>';
    }
    s2Html += '<div class="transit-seg__detail">'
      + _esc(opt.oStop.name) + ' → ' + _esc(opt.dStop.name)
      + ' · ' + transitDistMi.toFixed(1) + ' mi · ~' + tr + ' min'
      + '</div>';
    s2.innerHTML = s2Html;
    routeSteps.appendChild(s2);

    // Walk from stop
    const s3 = document.createElement('div');
    s3.className = 'transit-segment transit-segment--walk';
    s3.innerHTML = '<div class="transit-seg__header">🚶 Walk to destination</div>'
      + '<div class="transit-seg__detail">'
      + (walkFromStop
          ? formatMeters(walkFromStop.distance) + ' · ~' + Math.round(walkFromStop.duration / 60) + ' min'
          : walkFromDist.toFixed(2) + ' mi · ~' + wf + ' min')
      + '</div>';
    routeSteps.appendChild(s3);

    navStartBtn.removeAttribute('hidden');
    onRouteReady();
  }

  function renderSteps(steps) {
    routeSteps.innerHTML = '';
    steps.forEach(function (step) {
      if (!step.instruction) return;
      const div = document.createElement('div');
      div.className = 'route-step';
      const distText = step.distance > 15 ? formatMeters(step.distance) : '';
      div.innerHTML =
        '<span class="route-step__icon">' + _esc(step.icon) + '</span>' +
        '<span class="route-step__text">' + _esc(step.instruction) + '</span>' +
        (distText ? '<span class="route-step__dist">' + distText + '</span>' : '<span></span>');
      routeSteps.appendChild(div);
    });
  }

  // ── Live navigation ───────────────────────────────────────────
  function startNavigation() {
    if (!navigator.geolocation) {
      alert('Live navigation requires location access. Please enable it in your browser and reload.');
      return;
    }
    navActive = true;
    navStartBtn.setAttribute('hidden', '');
    navBar.removeAttribute('hidden');
    navEtaTime.textContent = 'Locating…';
    navEtaDist.textContent = '';

    // Request high-accuracy continuous position updates
    navWatchId = navigator.geolocation.watchPosition(
      onNavPosition,
      function (err) {
        console.warn('Navigation GPS error:', err.message);
        navEtaTime.textContent = 'GPS unavailable';
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
    );
  }

  function stopNavigation() {
    if (navWatchId !== null) {
      navigator.geolocation.clearWatch(navWatchId);
      navWatchId = null;
    }
    navActive = false;
    navBar.setAttribute('hidden', '');
    navStartBtn.removeAttribute('hidden');
    if (map) {
      BostonMap.clearLivePosition();
      if (navMode === 'transit') {
        // Transit segments are still drawn (we never wiped them); just re-fit
        BostonMap.fitRoutes();
      } else if (navRouteCoords.length > 1) {
        // Restore full single-line route for walk/car
        BostonMap.clearRoute();
        BostonMap.drawRoute({ type: 'LineString', coordinates: navRouteCoords },
          navMode === 'car' ? '#1565c0' : '#1a5c3a', false);
        BostonMap.fitRoutes();
      }
    }
  }

  function onNavPosition(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    if (map) {
      BostonMap.setLivePosition(lat, lng);
      BostonMap.panToLive(lat, lng);
    }

    // Update route progress split (skip for transit — route is multi-segment, live dot suffices)
    if (navMode !== 'transit' && navRouteCoords.length > 1 && map) {
      const idx = closestRouteIndex(navRouteCoords, lat, lng);
      BostonMap.updateRouteProgress(navRouteCoords, idx);
    }

    // Update ETA
    if (navDestLat !== null) {
      const remaining = dist(lat, lng, navDestLat, navDestLng);
      const speed = NAV_SPEED[navMode] || 3;
      const etaMins = Math.round(remaining * 1.3 / speed * 60);
      navEtaTime.textContent = etaMins < 1 ? 'Arriving' : '~' + etaMins + ' min';
      navEtaDist.textContent = formatDist(remaining) + ' remaining';

      if (remaining < 0.01) { // ~52 ft
        stopNavigation();
        alert('You have arrived at your destination!');
      }
    }
  }

  function closestRouteIndex(coords, userLat, userLng) {
    let min = Infinity, idx = 0;
    coords.forEach(function (c, i) {
      // GeoJSON coords are [lng, lat]
      const d = dist(userLat, userLng, c[1], c[0]);
      if (d < min) { min = d; idx = i; }
    });
    return idx;
  }

  // ── List renderers ────────────────────────────────────────────
  function renderNearestList(ulEl, items, nameProp, lat, lng, maxItems) {
    ulEl.innerHTML = '';
    if (!items.length) { ulEl.setAttribute('hidden', ''); return; }
    const sorted = items
      .map(item => ({ item, d: dist(lat, lng, parseFloat(item.lat), parseFloat(item.lng)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, maxItems || 8);
    sorted.forEach(function ({ item, d }) {
      const li = document.createElement('li');
      const iName = item[nameProp] || 'Unknown';
      const iAddr = item.address   || '';
      const iLat  = parseFloat(item.lat);
      const iLng  = parseFloat(item.lng);
      li.innerHTML =
        '<span class="place-main"><span class="place-name">' + _esc(iName) + '</span>' +
        (item.phone ? '<a class="place-phone" href="tel:' + _esc(item.phone) + '" onclick="event.stopPropagation()">' + _esc(item.phone) + '</a>' : '') +
        '</span><span class="place-dist">' + formatDist(d) + '</span>';
      li.title = 'Click for directions';
      li.setAttribute('tabindex', '0');
      li.setAttribute('role', 'button');
      li.addEventListener('mouseenter', function () {
        if (map && !isNaN(iLat)) BostonMap.drawHoverLine(iLat, iLng);
      });
      li.addEventListener('mouseleave', function () {
        if (map) BostonMap.clearHoverLine();
      });
      const go = function () {
        if (map) BostonMap.highlightMarker(iLat, iLng);
        showDirectionsPanel({ name: iName, address: iAddr, lat: iLat, lng: iLng }, d);
      };
      li.addEventListener('click', go);
      li.addEventListener('keydown', function (e) { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); go(); } });
      ulEl.appendChild(li);
    });
    ulEl.removeAttribute('hidden');
  }

  function renderHazardList(ulEl, hazards, lat, lng) {
    ulEl.innerHTML = '';
    if (!hazards.length) { ulEl.setAttribute('hidden', ''); return; }
    const sorted = hazards
      .map(h => ({ h, d: dist(lat, lng, h.lat, h.lng) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
    sorted.forEach(function ({ h, d }) {
      const li = document.createElement('li');
      const iName = h.title || h.type || 'Hazard';
      let dateStr = '';
      if (h.opened) {
        try { dateStr = new Date(h.opened).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
        catch (e) { dateStr = h.opened.slice(5, 10); }
      }
      li.innerHTML =
        '<span class="place-name">⚠️ ' + _esc(iName) + (dateStr ? ' <span class="hazard-date">(' + _esc(dateStr) + ')</span>' : '') + '</span>' +
        '<span class="place-dist">' + formatDist(d) + '</span>';
      li.title = 'Click for directions';
      li.setAttribute('tabindex', '0');
      li.setAttribute('role', 'button');
      li.addEventListener('mouseenter', function () {
        if (map && !isNaN(h.lat)) BostonMap.drawHoverLine(h.lat, h.lng);
      });
      li.addEventListener('mouseleave', function () {
        if (map) BostonMap.clearHoverLine();
      });
      const go = function () { showDirectionsPanel({ name: iName, address: h.address||'', lat: h.lat, lng: h.lng }, d); };
      li.addEventListener('click', go);
      li.addEventListener('keydown', function (e) { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); go(); } });
      ulEl.appendChild(li);
    });
    ulEl.removeAttribute('hidden');
  }

  // ── Geolocation (Use My Location button) ─────────────────────
  function handleLocate() {
    if (!navigator.geolocation) { alert('Your browser does not support location access.'); return; }
    locateBtn.disabled = true;
    locateBtn.textContent = '📍 Locating…';
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        locateBtn.disabled = false;
        locateBtn.textContent = '📍 Use My Location';
        const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        searchInput.value = 'My Current Location';
        selectedSuggestion = location;
        runSearch(location, 'My Current Location');
      },
      function () {
        locateBtn.disabled = false;
        locateBtn.textContent = '📍 Use My Location';
        alert('Could not access your location. Please allow location access in your browser.');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  // ── Map init ──────────────────────────────────────────────────
  function tryInitMap() {
    if (map) return;
    try { map = BostonMap.initMap('map'); }
    catch (err) { console.warn('Map init failed, retrying on search:', err); }
  }

  // ── Core search ───────────────────────────────────────────────

  // Render all sidebar cards + map markers for the current cached state.
  // Safe to call multiple times — clears data layers and redraws.
  function _applyResults(location, address, hazards) {
    const r  = searchRadius;
    const rl = ' within ' + r + ' mi';

    const nearbyHospitals = filterByRadius(allHospitals, location.lat, location.lng, r);
    const nearbyParks     = filterByRadius(allParks,     location.lat, location.lng, r);

    if (map) {
      BostonMap.clearDataLayers();
      BostonMap.plotHospitals(nearbyHospitals);
      BostonMap.plotParks(nearbyParks);
      BostonMap.plotHazards(hazards);
      if (_enabledOptionals.has('seniors'))   BostonMap.plotSeniorCenters(filterByRadius(allSeniorCenters,    location.lat, location.lng, r));
      if (_enabledOptionals.has('health'))    BostonMap.plotHealthCenters(filterByRadius(allHealthCenters,    location.lat, location.lng, r));
      if (_enabledOptionals.has('community')) BostonMap.plotCommunityCenters(filterByRadius(allCommunityCenters, location.lat, location.lng, r));
      if (_enabledOptionals.has('dental'))    BostonMap.plotDentalClinics(filterByRadius(allDentalClinics,    location.lat, location.lng, r));
      if (_enabledOptionals.has('mental'))    BostonMap.plotMentalHealth(filterByRadius(allMentalHealth,      location.lat, location.lng, r));
      if (_enabledOptionals.has('food'))      BostonMap.plotFoodPantries(filterByRadius(allFoodPantries,      location.lat, location.lng, r));
      if (_enabledOptionals.has('markets'))   BostonMap.plotFarmersMarkets(filterByRadius(allFarmersMarkets,  location.lat, location.lng, r));
      if (_enabledOptionals.has('cooling'))   BostonMap.plotCoolingCenters(filterByRadius(allCoolingCenters,  location.lat, location.lng, r));
    }

    // Update radius labels
    document.getElementById('hosp-radius-label').textContent  = rl;
    document.getElementById('parks-radius-label').textContent = rl;

    hospitalCount.textContent = nearbyHospitals.length || (allHospitals.length ? '0' : '…');
    parkCount.textContent     = nearbyParks.length     || (allParks.length     ? '0' : '…');
    hazardCount.textContent   = hazards.length;
    setVulnerabilityBadge(medianVulnScore());
    resultsAddress.textContent = address;

    // Update SNAP link to centre on the searched location
    var snapLink = document.getElementById('snap-link');
    if (snapLink) {
      snapLink.href = 'https://www.google.com/maps/search/grocery+store/@'
        + location.lat.toFixed(5) + ',' + location.lng.toFixed(5) + ',14z';
    }

    renderNearestList(hospList,  nearbyHospitals, 'name', location.lat, location.lng, 8);
    if (!nearbyHospitals.length) {
      var hospNote = allHospitals.length
        ? 'No hospitals within ' + r + ' mi of your location. Boston\'s major hospitals are clustered in the Longwood Medical Area (Brigham &amp; Women\'s, Children\'s, BIDMC, Dana-Farber) and downtown (MGH, Tufts). Try a wider radius or search one of those areas.'
        : 'Hospital data is loading… please wait a moment.';
      hospList.innerHTML = '<li class="nearest-item nearest-item--note">' + hospNote + '</li>';
      hospList.removeAttribute('hidden');
    }

    renderNearestList(parksList, nearbyParks,     'name', location.lat, location.lng, 8);

    if (!nearbyParks.length) {
      parksList.innerHTML = '<li class="nearest-item nearest-item--note">BPRD accessible parks data covers Boston proper. Nearby cities (Cambridge, Somerville) have separate park systems.</li>';
      parksList.removeAttribute('hidden');
    }
    renderHazardList(hazardsList, hazards, location.lat, location.lng);
    if (!hazards.length) {
      hazardsList.innerHTML = '<li class="nearest-item nearest-item--note">Boston 311 data covers Boston proper. Cambridge, Somerville &amp; other cities have separate systems.</li>';
      hazardsList.removeAttribute('hidden');
    }

    // Optional categories — only render if enabled
    _renderOptional('seniors',   allSeniorCenters,    seniorsCount,   seniorsList,   location, r, rl,
      'No senior centers within ' + r + ' mi. Try increasing the radius.');
    _renderOptional('health',    allHealthCenters,    healthCount,    healthList,    location, r, rl,
      'No community health centers within ' + r + ' mi.');
    _renderOptional('community', allCommunityCenters, communityCount, communityList, location, r, rl,
      'Boston BCYF community centers. Other cities have their own networks.');
    _renderOptional('dental',    allDentalClinics,    dentalCount,    dentalList,    location, r, rl,
      'No dental clinics found within ' + r + ' mi.');
    _renderOptional('mental',    allMentalHealth,     mentalCount,    mentalList,    location, r, rl,
      'No mental health services found within ' + r + ' mi.');
    _renderOptional('food',      allFoodPantries,     foodCount,      foodList,      location, r, rl,
      'No food pantries found within ' + r + ' mi.');
    _renderOptional('markets',   allFarmersMarkets,   marketsCount,   marketsList,   location, r, rl,
      'No farmers markets found within ' + r + ' mi.');
    _renderOptional('cooling',   allCoolingCenters,   coolingCount,   coolingList,   location, r, rl,
      'No cooling/warming centers found within ' + r + ' mi.');
  }

  function _renderOptional(cat, allData, countEl, listEl, location, r, rl, emptyNote) {
    if (!_enabledOptionals.has(cat)) return;
    const nearby = filterByRadius(allData, location.lat, location.lng, r);
    document.getElementById(cat + '-radius-label').textContent = rl;
    countEl.textContent = nearby.length || (allData.length ? '0' : '…');
    renderNearestList(listEl, nearby, 'name', location.lat, location.lng, 8);
    if (!nearby.length && allData.length) {
      listEl.innerHTML = '<li class="nearest-item nearest-item--note">' + emptyNote + '</li>';
      listEl.removeAttribute('hidden');
    }
  }

  // Kick off static dataset fetches that haven't loaded yet.
  // Returns a Promise that resolves when all pending fetches finish.
  // Pre-load only the core datasets (always shown). Optional categories load on demand.
  function _ensureStaticData() {
    const pending = [];
    if (!allHospitals.length)     pending.push(BostonAPI.fetchHospitals().then(h          => { allHospitals     = h; }).catch(() => {}));
    if (!allParks.length)         pending.push(BostonAPI.fetchAccessibleParks().then(p     => { allParks         = p; }).catch(() => {}));
    if (!allVulnerability.length) pending.push(BostonAPI.fetchSocialVulnerability().then(v => { allVulnerability = v; }).catch(() => {}));
    return pending.length ? Promise.all(pending) : Promise.resolve();
  }

  // Load a specific optional category on demand (called when chip is toggled on).
  async function _loadOptional(cat) {
    try {
      if (cat === 'seniors'   && !allSeniorCenters.length)    allSeniorCenters    = await BostonAPI.fetchSeniorCenters();
      if (cat === 'health'    && !allHealthCenters.length)    allHealthCenters    = await BostonAPI.fetchCommunityHealthCenters();
      if (cat === 'community' && !allCommunityCenters.length) allCommunityCenters = await BostonAPI.fetchCommunityCenters();
      if (cat === 'dental' && currentLocation)    allDentalClinics    = await BostonAPI.fetchDentalClinics(currentLocation.lat, currentLocation.lng, 5);
      if (cat === 'mental' && currentLocation)    allMentalHealth     = await BostonAPI.fetchMentalHealth(currentLocation.lat, currentLocation.lng, 5);
      if (cat === 'food'   && currentLocation)    allFoodPantries     = await BostonAPI.fetchFoodPantries(currentLocation.lat, currentLocation.lng, 5);
      if (cat === 'markets' && currentLocation)   allFarmersMarkets   = await BostonAPI.fetchFarmersMarkets(currentLocation.lat, currentLocation.lng, 5);
      if (cat === 'cooling' && currentLocation)   allCoolingCenters   = await BostonAPI.fetchCoolingCenters(currentLocation.lat, currentLocation.lng, 5);
    } catch (e) { console.warn('[App] optional load failed:', cat, e); }
  }

  async function runSearch(location, address) {
    showLoading();
    stopNavigation();
    _stopTransitRefresh();
    showPanel(resultsPanel);
    currentDest = null;

    // Clear location-specific Overpass caches for fresh fetch
    allDentalClinics = []; allMentalHealth = []; allFoodPantries = [];
    allFarmersMarkets = []; allCoolingCenters = [];

    try {
      if (!map) tryInitMap();
      if (map) {
        BostonMap.clearAll();
        BostonMap.setUserLocation(location.lat, location.lng, address, searchRadius);
        BostonMap.flyToLocation(location.lat, location.lng);
      }

      // Fire weather alerts in background (not awaited)
      BostonAPI.fetchWeatherAlerts(location.lat, location.lng).then(function(alerts) {
        var banner = document.getElementById('weather-banner');
        if (!banner) return;
        if (!alerts.length) { banner.setAttribute('hidden', ''); return; }
        var a = alerts[0];
        banner.className = 'weather-banner weather-banner--' + (a.isHeat ? 'heat' : 'cold');
        var textEl = banner.querySelector('.weather-banner__text');
        if (textEl) textEl.textContent = a.headline || a.event;
        banner.removeAttribute('hidden');
      }).catch(function() {});

      // Fire static fetches in background (no-op if already cached).
      // Fire hazards fetch (location-specific, always fresh) in parallel.
      const staticDone = _ensureStaticData();
      const hazards    = await BostonAPI.fetch311Hazards(location.lat, location.lng, 0.5);
      _lastHazards     = hazards;

      currentLocation = location;

      // Render immediately with whatever is cached — hazards are always ready,
      // static datasets show "…" if still loading.
      _applyResults(location, address, hazards);
      hideLoading();
      setTimeout(function () { if (map) map.invalidateSize(); }, 100);
      // Transit vehicles are NOT loaded automatically — only when user picks a transit route.

      // Fire Overpass fetches for any currently-enabled Overpass categories
      var overpassCats = ['dental', 'mental', 'food', 'markets', 'cooling'];
      var activeOverpass = overpassCats.filter(function(c) { return _enabledOptionals.has(c); });
      if (activeOverpass.length) {
        var overpassDone = Promise.all(activeOverpass.map(function(c) {
          return _loadOptional(c).catch(function() {});
        }));
        overpassDone.then(function() {
          if (currentLocation === location) {
            _applyResults(location, address, hazards);
          }
        });
      }

      // If any static datasets were still loading, silently re-render when done.
      staticDone.then(function () {
        if (currentLocation === location) {
          _applyResults(location, address, hazards);
        }
      });

    } catch (err) {
      console.error('Search failed:', err);
      alert('Something went wrong loading data. Please try again.');
      hideLoading();
    }
  }

  async function handleSearch() {
    const address = searchInput.value.trim();
    if (!address) return;
    hideSuggestions();
    if (selectedSuggestion) { runSearch(selectedSuggestion, address); selectedSuggestion = null; return; }
    showLoading();
    const location = await BostonAPI.geocodeAddress(address);
    hideLoading();
    if (!location) {
      alert('Address not found. Please include street number, street name, and city — e.g. "207 Prospect St, Cambridge, MA".');
      return;
    }
    runSearch(location, address);
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    // Pre-load core static datasets in the background immediately.
    _ensureStaticData();

    // ── Font size toggle ───────────────────────────────────────
    var fontToggleBtn = document.getElementById('font-toggle');
    if (fontToggleBtn) {
      fontToggleBtn.addEventListener('click', function () {
        var isLarge = document.body.classList.toggle('font-large');
        this.setAttribute('aria-pressed', isLarge ? 'true' : 'false');
        this.textContent = isLarge ? 'A−' : 'A+';
      });
    }

    // ── Share button ───────────────────────────────────────────
    var shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        if (!currentLocation) return;
        var params = new URLSearchParams({
          lat: currentLocation.lat.toFixed(6),
          lng: currentLocation.lng.toFixed(6),
          r: searchRadius,
        });
        var url = window.location.origin + window.location.pathname + '?' + params.toString();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(function () {
            alert('Link copied to clipboard!');
          }).catch(function () {
            prompt('Copy this link:', url);
          });
        } else {
          prompt('Copy this link:', url);
        }
      });
    }

    // ── Print button ───────────────────────────────────────────
    var printBtn = document.getElementById('print-btn');
    if (printBtn) {
      printBtn.addEventListener('click', function () { window.print(); });
    }

    // ── Radius selector ────────────────────────────────────────
    var radiusSelect = document.getElementById('radius-select');
    if (radiusSelect) {
      radiusSelect.addEventListener('change', function () {
        searchRadius = parseFloat(this.value);
        if (map && currentLocation) {
          BostonMap.updateCircleRadius(searchRadius);
          _applyResults(currentLocation, resultsAddress.textContent, _lastHazards);
        }
      });
    }

    // ── Optional category chips ────────────────────────────────
    document.querySelectorAll('.opt-chip').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var cat  = this.dataset.cat;
        var card = document.getElementById('card-' + cat);
        if (_enabledOptionals.has(cat)) {
          // Toggle OFF
          _enabledOptionals.delete(cat);
          this.classList.remove('opt-chip--on');
          if (card) card.setAttribute('hidden', '');
          if (map) BostonMap.clearLayer(cat);
        } else {
          // Toggle ON — fetch if needed, then render
          _enabledOptionals.add(cat);
          this.classList.add('opt-chip--loading');
          this.disabled = true;
          await _loadOptional(cat);
          this.classList.remove('opt-chip--loading');
          this.classList.add('opt-chip--on');
          this.disabled = false;
          if (card) card.removeAttribute('hidden');
          if (currentLocation) _applyResults(currentLocation, resultsAddress.textContent, _lastHazards);
        }
      });
    });

    searchBtn.addEventListener('click', handleSearch);
    locateBtn.addEventListener('click', handleLocate);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); handleSearch(); }
    });

    directionsBackBtn.addEventListener('click', function () {
      _clearActiveRoute();
      showPanel(resultsPanel);
      if (map) { BostonMap.clearRoute(); BostonMap.clearHoverLine(); BostonMap.clearHighlight(); }
    });

    directionsWalkBtn.addEventListener('click', showWalkingRoute);
    directionsCarBtn.addEventListener('click', showDrivingRoute);
    directionsTransitBtn.addEventListener('click', showTransitRoute);

    routeBackBtn.addEventListener('click', function () {
      stopNavigation();
      _clearActiveRoute();
      if (map) BostonMap.clearRoute();
      showPanel(directionsPanel);
    });

    navStartBtn.addEventListener('click', startNavigation);
    navStopBtn.addEventListener('click', stopNavigation);

    tryInitMap();

    // ── URL param restore ──────────────────────────────────────
    var params = new URLSearchParams(window.location.search);
    var sharedLat = parseFloat(params.get('lat'));
    var sharedLng = parseFloat(params.get('lng'));
    var sharedR   = parseFloat(params.get('r'));
    if (!isNaN(sharedLat) && !isNaN(sharedLng)) {
      if (!isNaN(sharedR) && radiusSelect) { searchRadius = sharedR; radiusSelect.value = sharedR; }
      runSearch({ lat: sharedLat, lng: sharedLng }, 'Shared Location');
    }
  }

  if (document.readyState === 'complete') { init(); }
  else { window.addEventListener('load', init); }

})();
