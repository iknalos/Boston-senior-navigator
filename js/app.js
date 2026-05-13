(function () {
  'use strict';

  const searchBtn     = document.getElementById('search-btn');
  const searchInput   = document.getElementById('address-input');
  const loadingOverlay = document.getElementById('loading-overlay');
  const resultsAddress = document.getElementById('results-address');
  const hospitalCount  = document.getElementById('hosp-count');
  const parkCount      = document.getElementById('parks-count');
  const hazardCount    = document.getElementById('hazards-count');
  const vulnBadge      = document.getElementById('vuln-badge');
  const suggestionsList = document.getElementById('address-suggestions');

  let map = null;
  let allHospitals = [];
  let allParks = [];
  let allVulnerability = [];
  let autocompleteTimer = null;
  let selectedSuggestion = null;

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

  // ── Address autocomplete ──────────────────────────────────────
  function hideSuggestions() {
    suggestionsList.setAttribute('hidden', '');
    suggestionsList.innerHTML = '';
  }

  function showSuggestions(results) {
    suggestionsList.innerHTML = '';
    if (!results.length) { hideSuggestions(); return; }
    results.forEach(function (r) {
      const li = document.createElement('li');
      li.textContent = r.display_name;
      li.dataset.lat = r.lat;
      li.dataset.lng = r.lon;
      li.addEventListener('mousedown', function (e) {
        e.preventDefault();
        searchInput.value = r.display_name;
        selectedSuggestion = { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
        hideSuggestions();
        runSearch(selectedSuggestion, r.display_name);
      });
      suggestionsList.appendChild(li);
    });
    suggestionsList.removeAttribute('hidden');
  }

  function fetchSuggestions(query) {
    if (query.length < 4) { hideSuggestions(); return; }
    const q = /boston/i.test(query) ? query : query + ', Boston, MA';
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=us&q=' + encodeURIComponent(q);
    fetch(url, { headers: { 'Accept-Language': 'en' } })
      .then(r => r.json())
      .then(showSuggestions)
      .catch(function () { hideSuggestions(); });
  }

  searchInput.addEventListener('input', function () {
    selectedSuggestion = null;
    clearTimeout(autocompleteTimer);
    autocompleteTimer = setTimeout(function () {
      fetchSuggestions(searchInput.value.trim());
    }, 300);
  });

  searchInput.addEventListener('blur', function () {
    setTimeout(hideSuggestions, 150);
  });

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
    try {
      // Re-init map if it failed on page load
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

      const nearbyHospitals = filterByRadius(allHospitals, location.lat, location.lng, 2);
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

    // If user selected from dropdown we already have coords
    if (selectedSuggestion) {
      runSearch(selectedSuggestion, address);
      selectedSuggestion = null;
      return;
    }

    showLoading();
    const location = await BostonAPI.geocodeAddress(address);
    hideLoading();
    if (!location) {
      alert('Address not found. Try something like "360 Huntington Ave, Boston, MA".');
      return;
    }
    runSearch(location, address);
  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    // Attach event listeners first — always, even if map init fails
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); handleSearch(); }
    });

    // Try to init map now; if it fails it will retry on first search
    tryInitMap();
  }

  // Use window load to ensure CSS layout is fully settled before map init
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }

})();
