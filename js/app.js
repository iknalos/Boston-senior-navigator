(function () {
  'use strict';

  const searchBtn = document.getElementById('search-btn');
  const searchInput = document.getElementById('address-input');
  const loadingOverlay = document.getElementById('loading-overlay');
  const placeholderState = document.getElementById('results-placeholder');
  const resultsPanel = document.getElementById('results-panel');
  const hospitalCount = document.getElementById('hosp-count');
  const parkCount = document.getElementById('parks-count');
  const hazardCount = document.getElementById('hazards-count');
  const vulnBadge = document.getElementById('vuln-badge');

  let map = null;
  let allHospitals = [];
  let allParks = [];
  let allVulnerability = [];

  function showLoading() { loadingOverlay.removeAttribute('hidden'); }
  function hideLoading() { loadingOverlay.setAttribute('hidden', ''); }

  function showResults() {
    placeholderState.setAttribute('hidden', '');
    resultsPanel.removeAttribute('hidden');
  }

  function setVulnerabilityBadge(score) {
    let label, cls;
    if (score === null || score === undefined) {
      label = 'Unknown'; cls = 'unknown';
    } else if (score < 33) {
      label = 'Low Risk'; cls = 'low';
    } else if (score < 66) {
      label = 'Medium Risk'; cls = 'medium';
    } else {
      label = 'High Risk'; cls = 'high';
    }
    vulnBadge.textContent = label;
    vulnBadge.className = 'vuln-badge vuln-badge--' + cls;
  }

  function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 3958.8;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function filterByRadius(items, lat, lng, radiusMiles) {
    return items.filter(item => {
      const itemLat = parseFloat(item.lat);
      const itemLng = parseFloat(item.lng);
      if (isNaN(itemLat) || isNaN(itemLng)) return false;
      return haversineDistance(lat, lng, itemLat, itemLng) <= radiusMiles;
    });
  }

  function findVulnerabilityScore(lat, lng) {
    if (!allVulnerability.length) return null;
    // Return the first neighborhood row (we don't have neighborhood boundary polygons,
    // so we approximate by returning the citywide median score)
    const scores = allVulnerability.map(r => r.vulnerability_score).filter(s => s != null);
    if (!scores.length) return null;
    scores.sort((a, b) => a - b);
    return scores[Math.floor(scores.length / 2)];
  }

  async function handleSearch(e) {
    if (e) e.preventDefault();
    const address = searchInput.value.trim();
    if (!address) return;

    showLoading();

    try {
      const location = await BostonAPI.geocodeAddress(address);
      if (!location) {
        hideLoading();
        alert('Address not found. Please try a Boston address like "360 Huntington Ave, Boston, MA".');
        return;
      }

      const { lat, lng } = location;

      if (!map) {
        map = BostonMap.initMap('map');
      }

      BostonMap.clearAll();
      BostonMap.setUserLocation(lat, lng, address);
      BostonMap.flyToLocation(lat, lng);

      // Fetch all data in parallel
      const [hazards] = await Promise.all([
        BostonAPI.fetch311Hazards(lat, lng, 0.5),
        allHospitals.length ? Promise.resolve() : BostonAPI.fetchHospitals().then(h => { allHospitals = h; }),
        allParks.length ? Promise.resolve() : BostonAPI.fetchAccessibleParks().then(p => { allParks = p; }),
        allVulnerability.length ? Promise.resolve() : BostonAPI.fetchSocialVulnerability().then(v => { allVulnerability = v; }),
      ]);

      const nearbyHospitals = filterByRadius(allHospitals, lat, lng, 2);
      const nearbyParks = filterByRadius(allParks, lat, lng, 1);
      const vulnScore = findVulnerabilityScore(lat, lng);

      BostonMap.plotHospitals(nearbyHospitals);
      BostonMap.plotParks(nearbyParks);
      BostonMap.plotHazards(hazards);

      hospitalCount.textContent = nearbyHospitals.length;
      parkCount.textContent = nearbyParks.length;
      hazardCount.textContent = hazards.length;
      setVulnerabilityBadge(vulnScore);

      showResults();
      setTimeout(function () { if (map) map.invalidateSize(); }, 100);
    } catch (err) {
      console.error('Search failed:', err);
      alert('Something went wrong. Please try again.');
    } finally {
      hideLoading();
    }
  }

  function init() {
    map = BostonMap.initMap('map');
    searchBtn.addEventListener('click', handleSearch);
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleSearch(e);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
