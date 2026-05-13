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
  const vulnBadge      = document.getElementById('vuln-badge');
  const suggestionsList = document.getElementById('address-suggestions');
  const hospList       = document.getElementById('hosp-list');
  const parksList      = document.getElementById('parks-list');
  const hazardsList    = document.getElementById('hazards-list');

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
  let autocompleteTimer = null, selectedSuggestion = null;
  let currentLocation = null;
  let currentDest = null;

  // Navigation state
  let navWatchId     = null;
  let navMode        = 'walk';     // 'walk' | 'car' | 'transit'
  let navRouteCoords = [];         // GeoJSON [lng, lat] pairs for progress tracking
  let navDestLat     = null;
  let navDestLng     = null;
  let navActive      = false;

  // Live transit vehicle refresh
  let _transitRefreshId = null;

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
    const vehicles = await BostonAPI.fetchMBTAVehicles();
    if (!map || !currentLocation) return;
    // Keep only vehicles within 5 miles of user
    const nearby = vehicles.filter(function (v) {
      return dist(currentLocation.lat, currentLocation.lng, v.lat, v.lng) <= 5;
    });
    BostonMap.plotTransitVehicles(nearby);
  }

  function _startTransitRefresh() {
    _stopTransitRefresh();
    _fetchAndPlotVehicles();
    _transitRefreshId = setInterval(_fetchAndPlotVehicles, 20000);
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
      li.textContent = r.label;
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
      BostonAPI.searchBostonAddresses(q).then(showSuggestions);
    }, 200);
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

  // ── Transit route (Google Maps–style: pick route → draw path) ────
  const ROUTE_TYPE_ICON  = { 0:'🚋', 1:'🚇', 2:'🚂', 3:'🚌', 4:'⛴️' };
  const TRANSIT_SPEED_MPH = { 0:15, 1:22, 2:35, 3:10, 4:18 };

  // Phase 1: fetch nearby route options and show as selectable cards
  async function showTransitRoute() {
    if (!currentLocation || !currentDest) return;
    navMode = 'transit';
    navDestLat = currentDest.lat;
    navDestLng = currentDest.lng;

    showPanel(routePanel);
    routeModeLabel.textContent = '🚌 Transit Route';
    routeSummary.innerHTML = '<div class="transit-total">Finding nearby routes…</div>';
    routeSteps.innerHTML   = '';
    navBar.setAttribute('hidden', '');
    navStartBtn.setAttribute('hidden', '');
    navRouteCoords = [];
    if (map) BostonMap.clearRoute();

    let options = [];
    try { options = await _fetchTransitOptions(); } catch (e) { console.error(e); }

    if (!options.length) {
      routeSummary.innerHTML = '<div class="transit-total">No routes found</div>';
      routeSteps.innerHTML   = '<p class="transit-no-routes">No MBTA routes connect these locations within walking distance. Try a closer destination or check the MBTA app.</p>';
      return;
    }

    routeSummary.innerHTML = '<div class="transit-total">Tap a route to plan it</div>';
    routeSteps.innerHTML   = '';

    options.forEach(function (opt) {
      const card = document.createElement('div');
      card.className = 'transit-option-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      const bg      = opt.route.color && opt.route.color !== '000000' ? '#' + opt.route.color : '#1a3a5c';
      const icon    = ROUTE_TYPE_ICON[opt.route.type] || '🚌';
      const depText = opt.nextDepartureMins !== null
        ? (opt.nextDepartureMins <= 1 ? 'Now' : 'in ' + opt.nextDepartureMins + ' min')
        : '— check app';

      card.innerHTML =
        '<div class="toc-header">'
        + '<span class="toc-badge" style="background:' + bg + '">' + _esc(opt.route.name) + '</span>'
        + '<span class="toc-name">' + icon + ' ' + _esc(opt.route.longName || opt.route.name) + '</span>'
        + '</div>'
        + '<div class="toc-row">'
        + '<span class="toc-total">~' + opt.estimatedTotalMins + ' min total</span>'
        + '<span class="toc-dep">Next: ' + depText + '</span>'
        + '</div>'
        + '<div class="toc-stops">' + _esc(opt.oStop.name) + ' → ' + _esc(opt.dStop.name) + '</div>';

      function go() { _planSelectedTransit(opt); }
      card.addEventListener('click', go);
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      routeSteps.appendChild(card);
    });
  }

  // Fetch up to 5 route options (common routes across nearby stop pairs)
  async function _fetchTransitOptions() {
    const fl = currentLocation.lat, fg = currentLocation.lng;
    const tl = currentDest.lat,     tg = currentDest.lng;

    const [originStops, destStops] = await Promise.all([
      BostonAPI.fetchMBTANearbyStops(fl, fg),
      BostonAPI.fetchMBTANearbyStops(tl, tg),
    ]);
    if (!originStops.length) return [];

    const oStops = originStops.slice(0, 3);
    const dStops = destStops.slice(0, 3);

    const [oRouteArrays, dRouteArrays, predArrays] = await Promise.all([
      Promise.all(oStops.map(function (s) { return BostonAPI.fetchMBTARoutesForStop(s.id); })),
      Promise.all(dStops.map(function (s) { return BostonAPI.fetchMBTARoutesForStop(s.id); })),
      Promise.all(oStops.map(function (s) { return BostonAPI.fetchMBTAPredictions(s.id); })),
    ]);

    const seen = new Set();
    const options = [];

    oStops.forEach(function (oStop, oi) {
      dStops.forEach(function (dStop, di) {
        const dRouteIds = new Set(dRouteArrays[di].map(function (r) { return r.id; }));
        oRouteArrays[oi].filter(function (r) { return dRouteIds.has(r.id); }).forEach(function (route) {
          const key = route.id + '|' + oStop.id + '|' + dStop.id;
          if (seen.has(key)) return;
          seen.add(key);

          const transitDist   = dist(oStop.lat, oStop.lng, dStop.lat, dStop.lng);
          const speedMph      = TRANSIT_SPEED_MPH[route.type] || 10;
          const transitMins   = Math.max(1, Math.round(transitDist / speedMph * 60));
          const walkToMins    = Math.max(1, Math.round(oStop.distance / 3 * 60));
          const walkFromMins  = Math.max(0, Math.round(dist(dStop.lat, dStop.lng, tl, tg) / 3 * 60));

          const preds             = (predArrays[oi] || []).filter(function (p) { return p.routeId === route.id; });
          const nextDepartureMins = preds.length > 0 ? Math.max(0, preds[0].minutesAway) : null;
          const waitMins          = nextDepartureMins !== null ? nextDepartureMins : 5;

          options.push({
            route, oStop, dStop,
            walkToMins, transitMins, walkFromMins,
            nextDepartureMins, allPreds: preds,
            estimatedTotalMins: walkToMins + waitMins + transitMins + walkFromMins,
          });
        });
      });
    });

    options.sort(function (a, b) { return a.estimatedTotalMins - b.estimatedTotalMins; });
    return options.slice(0, 5);
  }

  // Phase 2: plan and draw the full route for a selected option
  async function _planSelectedTransit(opt) {
    routeSummary.innerHTML = '<div class="transit-total">Planning route…</div>';
    routeSteps.innerHTML   = '';
    if (map) BostonMap.clearRoute();

    // Use OSRM driving for buses (follows roads), foot for rail
    const profile = opt.route.type === 3 ? 'driving' : 'foot';
    const [walkToStop, walkFromStop, transitRoute] = await Promise.all([
      BostonAPI.fetchOSRMRoute(currentLocation.lat, currentLocation.lng, opt.oStop.lat, opt.oStop.lng),
      BostonAPI.fetchOSRMRoute(opt.dStop.lat, opt.dStop.lng, currentDest.lat, currentDest.lng),
      BostonAPI.fetchOSRMRoute(opt.oStop.lat, opt.oStop.lng, opt.dStop.lat, opt.dStop.lng, profile),
    ]);

    const transitColor = opt.route.color && opt.route.color !== '000000' ? '#' + opt.route.color : '#1565c0';
    const icon         = ROUTE_TYPE_ICON[opt.route.type] || '🚌';
    const bg           = opt.route.color && opt.route.color !== '000000' ? '#' + opt.route.color : '#1a3a5c';

    // Draw on map
    if (map) {
      if (walkToStop)   BostonMap.drawRoute(walkToStop.geometry,   '#1a5c3a',    true);
      if (transitRoute) BostonMap.drawRoute(transitRoute.geometry, transitColor, false);
      else              BostonMap.drawRoute({ type:'LineString', coordinates:[[opt.oStop.lng,opt.oStop.lat],[opt.dStop.lng,opt.dStop.lat]] }, transitColor, false);
      if (walkFromStop) BostonMap.drawRoute(walkFromStop.geometry, '#1a5c3a',    true);
      BostonMap.fitRoutes();
    }

    // Build combined coords for ETA tracking
    const allCoords = [];
    if (walkToStop)   allCoords.push(...walkToStop.geometry.coordinates);
    if (transitRoute) allCoords.push(...transitRoute.geometry.coordinates);
    else              allCoords.push([opt.oStop.lng,opt.oStop.lat],[opt.dStop.lng,opt.dStop.lat]);
    if (walkFromStop) allCoords.push(...walkFromStop.geometry.coordinates);
    navRouteCoords = allCoords;

    // Times
    const wt  = walkToStop   ? Math.round(walkToStop.duration  / 60) : opt.walkToMins;
    const wf  = walkFromStop ? Math.round(walkFromStop.duration / 60) : opt.walkFromMins;
    const wa  = opt.nextDepartureMins !== null ? opt.nextDepartureMins : 5;
    const tr  = opt.transitMins;
    const tot = wt + wa + tr + wf;

    routeSummary.innerHTML =
      '<div class="transit-total">~' + tot + ' min total</div>'
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
      + (walkToStop ? formatMeters(walkToStop.distance) + ' · ~' + Math.round(walkToStop.duration/60) + ' min' : '~' + wt + ' min')
      + '</div>';
    routeSteps.appendChild(s1);

    // Transit segment
    const s2 = document.createElement('div');
    s2.className = 'transit-segment transit-segment--bus';
    let s2Html = '<div class="transit-seg__header">'
      + '<span class="transit-route-badge" style="background:' + bg + '">' + _esc(opt.route.name) + '</span> '
      + icon + ' <strong>' + _esc(opt.route.longName || opt.route.name) + '</strong></div>';
    if (opt.allPreds && opt.allPreds.length) {
      s2Html += '<div class="transit-seg__preds"><strong>Next departures:</strong> '
        + opt.allPreds.slice(0, 5).map(function (p) { return p.minutesAway <= 1 ? '<span class="pred-now">Now</span>' : p.minutesAway + ' min'; }).join(' · ')
        + '</div>';
    }
    s2Html += '<div class="transit-seg__detail">' + _esc(opt.oStop.name) + ' → ' + _esc(opt.dStop.name) + '</div>';
    s2.innerHTML = s2Html;
    routeSteps.appendChild(s2);

    // Walk from stop
    const s3 = document.createElement('div');
    s3.className = 'transit-segment transit-segment--walk';
    s3.innerHTML = '<div class="transit-seg__header">🚶 Walk from <strong>' + _esc(opt.dStop.name) + '</strong></div>'
      + '<div class="transit-seg__detail">'
      + (walkFromStop ? formatMeters(walkFromStop.distance) + ' · ~' + Math.round(walkFromStop.duration/60) + ' min' : '~' + wf + ' min')
      + ' to destination</div>';
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
        '<span class="place-name">' + _esc(iName) + '</span>' +
        '<span class="place-dist">' + formatDist(d) + '</span>';
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
      li.innerHTML =
        '<span class="place-name">⚠️ ' + _esc(iName) + '</span>' +
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
  async function runSearch(location, address) {
    showLoading();
    stopNavigation();
    _stopTransitRefresh();
    showPanel(resultsPanel);
    currentDest = null;
    try {
      if (!map) tryInitMap();
      if (map) {
        BostonMap.clearAll();
        BostonMap.setUserLocation(location.lat, location.lng, address);
        BostonMap.flyToLocation(location.lat, location.lng);
      }

      const [hazards] = await Promise.all([
        BostonAPI.fetch311Hazards(location.lat, location.lng, 0.5),
        allHospitals.length     ? Promise.resolve() : BostonAPI.fetchHospitals().then(h     => { allHospitals     = h; }),
        allParks.length         ? Promise.resolve() : BostonAPI.fetchAccessibleParks().then(p => { allParks         = p; }),
        allVulnerability.length ? Promise.resolve() : BostonAPI.fetchSocialVulnerability().then(v => { allVulnerability = v; }),
      ]);

      currentLocation = location;
      const nearbyHospitals = filterByRadius(allHospitals, location.lat, location.lng, 3);
      const nearbyParks     = filterByRadius(allParks,     location.lat, location.lng, 1);

      if (map) {
        BostonMap.plotHospitals(nearbyHospitals);
        BostonMap.plotParks(nearbyParks);
        BostonMap.plotHazards(hazards);
        setTimeout(function () { map.invalidateSize(); }, 100);
      }

      hospitalCount.textContent  = nearbyHospitals.length;
      parkCount.textContent      = nearbyParks.length;
      hazardCount.textContent    = hazards.length;
      setVulnerabilityBadge(medianVulnScore());
      resultsAddress.textContent = address;

      renderNearestList(hospList,   nearbyHospitals, 'name', location.lat, location.lng, 8);
      renderNearestList(parksList,  nearbyParks,     'name', location.lat, location.lng, 8);
      renderHazardList(hazardsList, hazards, location.lat, location.lng);

      _startTransitRefresh();

    } catch (err) {
      console.error('Search failed:', err);
      alert('Something went wrong loading data. Please try again.');
    } finally {
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
    searchBtn.addEventListener('click', handleSearch);
    locateBtn.addEventListener('click', handleLocate);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); handleSearch(); }
    });

    directionsBackBtn.addEventListener('click', function () {
      showPanel(resultsPanel);
      if (map) { BostonMap.clearRoute(); BostonMap.clearHoverLine(); BostonMap.clearHighlight(); }
    });

    directionsWalkBtn.addEventListener('click', showWalkingRoute);
    directionsCarBtn.addEventListener('click', showDrivingRoute);
    directionsTransitBtn.addEventListener('click', showTransitRoute);

    routeBackBtn.addEventListener('click', function () {
      stopNavigation();
      if (map) BostonMap.clearRoute();
      showPanel(directionsPanel);
    });

    navStartBtn.addEventListener('click', startNavigation);
    navStopBtn.addEventListener('click', stopNavigation);

    tryInitMap();
  }

  if (document.readyState === 'complete') { init(); }
  else { window.addEventListener('load', init); }

})();
