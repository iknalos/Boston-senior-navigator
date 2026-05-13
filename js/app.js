(function () {
  'use strict';

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
  const resultsPanel   = document.getElementById('results-panel');
  const directionsPanel    = document.getElementById('directions-panel');
  const directionsBackBtn  = document.getElementById('directions-back-btn');
  const directionsName     = document.getElementById('directions-name');
  const directionsAddr     = document.getElementById('directions-addr');
  const directionsTime     = document.getElementById('directions-time');
  const directionsWalkLink    = document.getElementById('directions-walk-link');
  const directionsTransitLink = document.getElementById('directions-transit-link');
  const mbtaStopsList  = document.getElementById('mbta-stops-list');

  let map = null;
  let allHospitals = [];
  let allParks = [];
  let allVulnerability = [];
  let autocompleteTimer = null;
  let selectedSuggestion = null;
  let currentLocation = null;

  // ── Helpers ───────────────────────────────────────────────────
  function _escHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Loading overlay ───────────────────────────────────────────
  function showLoading() { loadingOverlay.removeAttribute('hidden'); }
  function hideLoading()  { loadingOverlay.setAttribute('hidden', ''); }

  // ── Vulnerability badge ───────────────────────────────────────
  function setVulnerabilityBadge(score) {
    let label, cls;
    if (score == null)    { label = 'Unknown';     cls = 'unknown'; }
    else if (score < 33)  { label = 'Low Risk';    cls = 'low';     }
    else if (score < 66)  { label = 'Medium Risk'; cls = 'medium';  }
    else                  { label = 'High Risk';   cls = 'high';    }
    vulnBadge.textContent = label;
    vulnBadge.className   = 'vuln-badge vuln-badge--' + cls;
  }

  // ── Haversine distance (miles) ────────────────────────────────
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

  function formatDist(miles) {
    return miles < 0.1 ? (miles * 5280).toFixed(0) + ' ft' : miles.toFixed(1) + ' mi';
  }

  function walkingTime(miles) {
    const mins = Math.round(miles * 1.3 / 3 * 60);
    if (mins < 60) return '~' + mins + ' min walk';
    const h = Math.floor(mins / 60), m = mins % 60;
    return '~' + h + 'h ' + (m ? m + 'min ' : '') + 'walk';
  }

  function googleMapsURL(destLat, destLng, mode) {
    if (!currentLocation) return '#';
    const origin = currentLocation.lat + ',' + currentLocation.lng;
    const dest   = destLat + ',' + destLng;
    return 'https://www.google.com/maps/dir/?api=1'
         + '&origin=' + encodeURIComponent(origin)
         + '&destination=' + encodeURIComponent(dest)
         + '&travelmode=' + mode;
  }

  // ── Address autocomplete (Boston SAM dataset) ─────────────────
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
    const query = searchInput.value.trim();
    if (query.length < 2) { hideSuggestions(); return; }
    autocompleteTimer = setTimeout(function () {
      BostonAPI.searchBostonAddresses(query).then(showSuggestions);
    }, 200);
  });

  searchInput.addEventListener('blur', function () {
    setTimeout(hideSuggestions, 150);
  });

  // ── Directions panel ──────────────────────────────────────────
  function showDirectionsPanel(item, distMiles) {
    directionsName.textContent = item.name    || 'Destination';
    directionsAddr.textContent = item.address || '';
    directionsTime.textContent = walkingTime(distMiles);
    directionsWalkLink.href    = googleMapsURL(item.lat, item.lng, 'walking');
    directionsTransitLink.href = googleMapsURL(item.lat, item.lng, 'transit');

    resultsPanel.setAttribute('hidden', '');
    directionsPanel.removeAttribute('hidden');

    if (map) {
      BostonMap.clearHoverLine();
      BostonMap.flyToLocation(item.lat, item.lng);
    }

    mbtaStopsList.innerHTML = '<p class="mbta-loading">Loading transit info&hellip;</p>';
    loadMBTAStops(item.lat, item.lng);
  }

  function hideDirectionsPanel() {
    directionsPanel.setAttribute('hidden', '');
    resultsPanel.removeAttribute('hidden');
    if (map) BostonMap.clearHoverLine();
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
        const stopDiv = document.createElement('div');
        stopDiv.className = 'mbta-stop';
        let html = '<span class="mbta-stop__name">' + _escHTML(stop.name) + '</span>'
                 + '<span class="mbta-stop__dist">(' + formatDist(stop.distance) + ')</span>';
        if (!preds.length) {
          html += '<div class="mbta-arrival"><span class="mbta-arrival__time">No upcoming arrivals</span></div>';
        } else {
          preds.forEach(function (p) {
            const timeLabel = p.minutesAway <= 1 ? 'Now' : p.minutesAway + ' min (' + p.departureTime + ')';
            html += '<div class="mbta-arrival">'
                  + '<span class="mbta-arrival__route">' + _escHTML(p.routeName) + '</span>'
                  + '<span class="mbta-arrival__time">' + timeLabel + '</span>'
                  + '</div>';
          });
        }
        stopDiv.innerHTML = html;
        mbtaStopsList.appendChild(stopDiv);
      });
    } catch (err) {
      console.error('loadMBTAStops failed:', err);
      mbtaStopsList.innerHTML = '<p class="mbta-no-stops">Could not load transit info.</p>';
    }
  }

  // ── Distance list renderer ────────────────────────────────────
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
        '<span class="place-name">' + _escHTML(iName) + '</span>' +
        '<span class="place-dist">' + formatDist(d) + '</span>';
      li.title = 'Click for directions';
      li.setAttribute('tabindex', '0');
      li.setAttribute('role', 'button');
      li.addEventListener('mouseenter', function () {
        if (map && !isNaN(iLat) && !isNaN(iLng)) BostonMap.drawHoverLine(iLat, iLng);
      });
      li.addEventListener('mouseleave', function () {
        if (map) BostonMap.clearHoverLine();
      });
      li.addEventListener('click', function () {
        showDirectionsPanel({ name: iName, address: iAddr, lat: iLat, lng: iLng }, d);
      });
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showDirectionsPanel({ name: iName, address: iAddr, lat: iLat, lng: iLng }, d);
        }
      });
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
      const iAddr = h.address || '';
      li.innerHTML =
        '<span class="place-name">⚠️ ' + _escHTML(iName) + '</span>' +
        '<span class="place-dist">' + formatDist(d) + '</span>';
      li.title = 'Click for directions';
      li.setAttribute('tabindex', '0');
      li.setAttribute('role', 'button');
      li.addEventListener('mouseenter', function () {
        if (map && !isNaN(h.lat) && !isNaN(h.lng)) BostonMap.drawHoverLine(h.lat, h.lng);
      });
      li.addEventListener('mouseleave', function () {
        if (map) BostonMap.clearHoverLine();
      });
      li.addEventListener('click', function () {
        showDirectionsPanel({ name: iName, address: iAddr, lat: h.lat, lng: h.lng }, d);
      });
      li.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showDirectionsPanel({ name: iName, address: iAddr, lat: h.lat, lng: h.lng }, d);
        }
      });
      ulEl.appendChild(li);
    });
    ulEl.removeAttribute('hidden');
  }

  // ── Geolocation ───────────────────────────────────────────────
  function handleLocate() {
    if (!navigator.geolocation) {
      alert('Your browser does not support location access.');
      return;
    }
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
        alert('Could not access your location. Please allow location access in your browser and try again.');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  }

  // ── Map initialisation (safe, deferred) ───────────────────────
  function tryInitMap() {
    if (map) return;
    try {
      map = BostonMap.initMap('map');
    } catch (err) {
      console.warn('Map init failed, will retry on search:', err);
    }
  }

  // ── Core search logic ─────────────────────────────────────────
  async function runSearch(location, address) {
    showLoading();
    // Close directions panel if open
    hideDirectionsPanel();
    try {
      if (!map) { tryInitMap(); }

      if (map) {
        BostonMap.clearAll();
        BostonMap.setUserLocation(location.lat, location.lng, address);
        BostonMap.flyToLocation(location.lat, location.lng);
      }

      const [hazards] = await Promise.all([
        BostonAPI.fetch311Hazards(location.lat, location.lng, 0.5),
        allHospitals.length    ? Promise.resolve() : BostonAPI.fetchHospitals().then(h => { allHospitals = h; }),
        allParks.length        ? Promise.resolve() : BostonAPI.fetchAccessibleParks().then(p => { allParks = p; }),
        allVulnerability.length? Promise.resolve() : BostonAPI.fetchSocialVulnerability().then(v => { allVulnerability = v; }),
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

      hospitalCount.textContent = nearbyHospitals.length;
      parkCount.textContent     = nearbyParks.length;
      hazardCount.textContent   = hazards.length;
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
      alert('Address not found. Please include a street number, street name, and city — e.g. "207 Prospect St, Cambridge, MA".');
      return;
    }
    runSearch(location, address);
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    searchBtn.addEventListener('click', handleSearch);
    locateBtn.addEventListener('click', handleLocate);
    directionsBackBtn.addEventListener('click', hideDirectionsPanel);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); handleSearch(); }
    });
    tryInitMap();
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }

})();
