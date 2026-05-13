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

  // Panel containers
  const resultsPanel       = document.getElementById('results-panel');
  const directionsPanel    = document.getElementById('directions-panel');
  const routePanel         = document.getElementById('route-panel');

  // Directions panel elements
  const directionsBackBtn  = document.getElementById('directions-back-btn');
  const directionsName     = document.getElementById('directions-name');
  const directionsAddr     = document.getElementById('directions-addr');
  const directionsTime     = document.getElementById('directions-time');
  const directionsWalkBtn  = document.getElementById('directions-walk-btn');
  const directionsTransitBtn = document.getElementById('directions-transit-btn');
  const mbtaStopsList      = document.getElementById('mbta-stops-list');

  // Route panel elements
  const routeBackBtn    = document.getElementById('route-back-btn');
  const routeModeLabel  = document.getElementById('route-mode-label');
  const routeSummary    = document.getElementById('route-summary');
  const routeSteps      = document.getElementById('route-steps');

  // ── State ─────────────────────────────────────────────────────
  let map = null;
  let allHospitals = [];
  let allParks = [];
  let allVulnerability = [];
  let autocompleteTimer = null;
  let selectedSuggestion = null;
  let currentLocation = null;
  let currentDest = null;

  // ── Helpers ───────────────────────────────────────────────────
  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDist(miles) {
    return miles < 0.1 ? (miles * 5280).toFixed(0) + ' ft' : miles.toFixed(1) + ' mi';
  }

  function formatMeters(m) {
    if (m < 160) return Math.round(m) + ' m';
    return (m / 1609.34).toFixed(1) + ' mi';
  }

  function formatSeconds(s) {
    const mins = Math.round(s / 60);
    if (mins < 60) return mins + ' min';
    const h = Math.floor(mins / 60), mm = mins % 60;
    return h + ' h' + (mm ? ' ' + mm + ' min' : '');
  }

  function walkingTime(miles) {
    const mins = Math.round(miles * 1.3 / 3 * 60);
    return '~' + (mins < 60 ? mins + ' min' : Math.floor(mins/60) + ' h ' + (mins%60||'') + (mins%60 ? ' min' : '') ) + ' walk';
  }

  // ── Panel helpers ─────────────────────────────────────────────
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

  // ── Distance math ─────────────────────────────────────────────
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
    const scores = allVulnerability.map(r => r.vulnerability_score).filter(s => s != null);
    if (!scores.length) return null;
    scores.sort((a, b) => a - b);
    return scores[Math.floor(scores.length / 2)];
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
            html += '<div class="mbta-arrival">'
                  + '<span class="mbta-arrival__route">' + _esc(p.routeName) + '</span>'
                  + '<span class="mbta-arrival__time">' + t + '</span>'
                  + '</div>';
          });
        }
        div.innerHTML = html;
        mbtaStopsList.appendChild(div);
      });
    } catch (err) {
      console.error('loadMBTAStops failed:', err);
      mbtaStopsList.innerHTML = '<p class="mbta-no-stops">Could not load transit info.</p>';
    }
  }

  // ── Route panel — walking ─────────────────────────────────────
  async function showWalkingRoute() {
    if (!currentLocation || !currentDest) return;
    showPanel(routePanel);
    routeModeLabel.textContent = '🚶 Walking Route';
    routeSummary.textContent   = 'Loading route…';
    routeSteps.innerHTML = '';
    if (map) BostonMap.clearRoute();

    const route = await BostonAPI.fetchOSRMRoute(
      currentLocation.lat, currentLocation.lng,
      currentDest.lat, currentDest.lng
    );

    if (!route) {
      routeSummary.textContent = 'Could not load walking route. Try again.';
      return;
    }

    if (map) {
      BostonMap.drawRoute(route.geometry, '#1a5c3a', false);
      BostonMap.fitRoutes();
    }

    const distMi = (route.distance / 1609.34).toFixed(1);
    routeSummary.innerHTML =
      '<strong>' + distMi + ' mi</strong> &nbsp;·&nbsp; ~' + formatSeconds(route.duration);

    routeSteps.innerHTML = '';
    route.steps.forEach(function (step) {
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

  // ── Route panel — transit ─────────────────────────────────────
  const ROUTE_TYPE_ICON = { 0:'🚋', 1:'🚇', 2:'🚂', 3:'🚌', 4:'⛴️' };

  async function showTransitRoute() {
    if (!currentLocation || !currentDest) return;
    showPanel(routePanel);
    routeModeLabel.textContent = '🚌 Transit Route';
    routeSummary.textContent   = 'Planning route…';
    routeSteps.innerHTML = '';
    if (map) BostonMap.clearRoute();

    const data = await BostonAPI.planTransitRoute(
      currentLocation.lat, currentLocation.lng,
      currentDest.lat, currentDest.lng
    );

    if (!data) {
      routeSummary.textContent = 'Could not plan transit route. Check your connection.';
      return;
    }

    routeSteps.innerHTML = '';
    let totalWalkSecs = 0;

    // ── Segment 1: walk to origin MBTA stop ──────────────────────
    const walkSeg = document.createElement('div');
    walkSeg.className = 'transit-segment transit-segment--walk';
    if (data.walkToStop) {
      totalWalkSecs += data.walkToStop.duration;
      walkSeg.innerHTML =
        '<div class="transit-seg__header">🚶 Walk to <strong>' + _esc(data.originStop.name) + '</strong></div>' +
        '<div class="transit-seg__detail">' +
          formatMeters(data.walkToStop.distance) + ' &nbsp;·&nbsp; ~' + formatSeconds(data.walkToStop.duration) +
        '</div>';
      if (map) BostonMap.drawRoute(data.walkToStop.geometry, '#1a5c3a', true);
    } else {
      walkSeg.innerHTML =
        '<div class="transit-seg__header">📍 Start at <strong>' + _esc(data.originStop.name) + '</strong></div>';
    }
    routeSteps.appendChild(walkSeg);

    // ── Segment 2: transit routes ─────────────────────────────────
    const busSeg = document.createElement('div');
    busSeg.className = 'transit-segment transit-segment--bus';
    const routesToShow = (data.commonRoutes && data.commonRoutes.length > 0)
      ? data.commonRoutes : (data.originRoutes || []);

    let busHtml = '<div class="transit-seg__header">Board one of these routes:</div>';
    if (routesToShow.length) {
      routesToShow.slice(0, 5).forEach(function (r) {
        const icon = ROUTE_TYPE_ICON[r.type] || '🚌';
        const bg   = r.color && r.color !== '000000' ? '#' + r.color : '#1a3a5c';
        busHtml += '<div class="transit-seg__route">'
                 + '<span class="transit-route-badge" style="background:' + bg + '">' + _esc(r.name) + '</span>'
                 + ' ' + icon + ' ' + _esc(r.longName)
                 + '</div>';
      });
    } else {
      busHtml += '<div class="transit-seg__route">Check MBTA trip planner for available routes.</div>';
    }

    if (data.predictions && data.predictions.length) {
      busHtml += '<div class="transit-seg__preds"><strong>Next departures:</strong>&nbsp;';
      busHtml += data.predictions.map(function (p) {
        return p.minutesAway <= 1
          ? '<span class="pred-now">Now</span>'
          : p.minutesAway + ' min';
      }).join(' · ');
      busHtml += '</div>';
    } else {
      busHtml += '<div class="transit-seg__preds">No live predictions — check MBTA app.</div>';
    }

    if (!data.commonRoutes || !data.commonRoutes.length) {
      busHtml += '<div class="transit-seg__preds" style="color:#8b2e00">⚠️ A transfer may be needed — routes above serve your boarding stop but may not go directly to the destination.</div>';
    }

    busSeg.innerHTML = busHtml;
    routeSteps.appendChild(busSeg);

    // ── Segment 3: walk from destination MBTA stop ────────────────
    if (data.destStop && data.walkFromStop) {
      totalWalkSecs += data.walkFromStop.duration;
      const walkSeg2 = document.createElement('div');
      walkSeg2.className = 'transit-segment transit-segment--walk';
      walkSeg2.innerHTML =
        '<div class="transit-seg__header">🚶 Walk from <strong>' + _esc(data.destStop.name) + '</strong></div>' +
        '<div class="transit-seg__detail">' +
          formatMeters(data.walkFromStop.distance) + ' &nbsp;·&nbsp; ~' + formatSeconds(data.walkFromStop.duration) + ' to destination' +
        '</div>';
      routeSteps.appendChild(walkSeg2);
      if (map) BostonMap.drawRoute(data.walkFromStop.geometry, '#1a5c3a', true);
    }

    if (map) BostonMap.fitRoutes();

    routeSummary.innerHTML =
      '<strong>~' + formatSeconds(totalWalkSecs) + ' walking</strong>' +
      (data.commonRoutes && data.commonRoutes.length
        ? ' + transit time varies'
        : ' — check MBTA for full trip time');
  }

  // ── List renderers (with hover + click) ───────────────────────
  function renderNearestList(ulEl, items, nameProp, lat, lng, maxItems) {
    ulEl.innerHTML = '';
    if (!items.length) { ulEl.setAttribute('hidden', ''); return; }
    const sorted = items
      .map(item => ({ item, d: dist(lat, lng, parseFloat(item.lat), parseFloat(item.lng)) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, maxItems || 8);
    sorted.forEach(function ({ item, d }) {
      const li    = document.createElement('li');
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
      const handler = function () { showDirectionsPanel({ name: iName, address: iAddr, lat: iLat, lng: iLng }, d); };
      li.addEventListener('click', handler);
      li.addEventListener('keydown', function (e) { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); handler(); } });
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
      const li    = document.createElement('li');
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
      const handler = function () { showDirectionsPanel({ name: iName, address: h.address||'', lat: h.lat, lng: h.lng }, d); };
      li.addEventListener('click', handler);
      li.addEventListener('keydown', function (e) { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); handler(); } });
      ulEl.appendChild(li);
    });
    ulEl.removeAttribute('hidden');
  }

  // ── Geolocation ───────────────────────────────────────────────
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
    catch (err) { console.warn('Map init failed, will retry on search:', err); }
  }

  // ── Core search ───────────────────────────────────────────────
  async function runSearch(location, address) {
    showLoading();
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
    if (selectedSuggestion) {
      runSearch(selectedSuggestion, address);
      selectedSuggestion = null;
      return;
    }
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
      if (map) { BostonMap.clearRoute(); BostonMap.clearHoverLine(); }
    });

    directionsWalkBtn.addEventListener('click', showWalkingRoute);
    directionsTransitBtn.addEventListener('click', showTransitRoute);

    routeBackBtn.addEventListener('click', function () {
      if (map) BostonMap.clearRoute();
      showPanel(directionsPanel);
    });

    tryInitMap();
  }

  if (document.readyState === 'complete') { init(); }
  else { window.addEventListener('load', init); }

})();
