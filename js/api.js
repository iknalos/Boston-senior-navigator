/**
 * api.js — Age-Friendly Boston data layer
 *
 * Fetches all relevant datasets from the Boston CKAN Open Data API
 * (https://data.boston.gov/api/3/action/datastore_search) and the
 * free Nominatim geocoding service.
 *
 * All functions are async, use fetch(), handle errors gracefully
 * (returning empty arrays on failure), and are exported on window.BostonAPI.
 *
 * Verified resource IDs (fetched 2026-05-13):
 *   Hospitals CSV          : 9ce5935a-bc4f-4a5c-a063-0f15fc01513a
 *   BPRD Park Entrances CSV: 2705f51f-a8ab-494f-a9a8-ce00d112f29b
 *   BPRD Park Details CSV  : 5dbfc0b1-c72c-4bc2-8ea8-4688e252a638
 *   311 Requests 2025      : 9d7c2214-4709-478a-a2e8-fb2020a5bb94
 *   311 Requests 2024      : dff4d804-5031-443a-8409-8344efd0e5c8
 *   Social Vulnerability CSV: 3d506197-74e9-4032-a455-fe231ea9daf1
 */

(function (global) {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────

  const CKAN_BASE = 'https://data.boston.gov/api/3/action/datastore_search';

  const RESOURCE_IDS = {
    hospitals:           '9ce5935a-bc4f-4a5c-a063-0f15fc01513a',
    parkEntrances:       '2705f51f-a8ab-494f-a9a8-ce00d112f29b',
    parkDetails:         '5dbfc0b1-c72c-4bc2-8ea8-4688e252a638',
    requests311_2026:    '1a0b420d-99f1-4887-9851-990b2a5a6e17',
    requests311_2025:    '9d7c2214-4709-478a-a2e8-fb2020a5bb94',
    requests311_2024:    'dff4d804-5031-443a-8409-8344efd0e5c8',
    socialVulnerability: '3d506197-74e9-4032-a455-fe231ea9daf1',
    samAddresses:        '6d6cfc99-6f26-4974-bbb3-17b5dbad49a9',
  };

  // 311 type/case_title keywords relevant to elderly fall & navigation hazards
  const HAZARD_KEYWORDS = [
    'sidewalk',
    'pothole',
    'street light',
    'streetlight',
    'sign',
    'curb',
    'crosswalk',
    'ramp',
    'ice',
    'snow',
    'trip hazard',
  ];

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** Reject a promise after `ms` milliseconds. */
  function _withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('timeout')); }, ms);
      }),
    ]);
  }

  /**
   * Fetch ALL records from a CKAN datastore resource, auto-paginating.
   * @param {string} resourceId
   * @param {URLSearchParams|Object} [extraParams]
   * @param {number} [pageSize=1000]
   * @returns {Promise<Object[]>}
   */
  async function fetchAllRecords(resourceId, extraParams = {}, pageSize = 1000) {
    const allRecords = [];
    let offset = 0;
    let total = Infinity;

    while (allRecords.length < total) {
      const params = new URLSearchParams({
        resource_id: resourceId,
        limit: pageSize,
        offset,
        ...extraParams,
      });
      const url = `${CKAN_BASE}?${params}`;

      const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      const json = await response.json();
      if (!json.success) {
        throw new Error(`CKAN error: ${json.error ? JSON.stringify(json.error) : 'unknown'}`);
      }

      const result = json.result;
      total = result.total;
      allRecords.push(...result.records);
      offset += result.records.length;

      // Safety: if we got fewer records than pageSize we're done
      if (result.records.length < pageSize) break;
    }

    return allRecords;
  }

  /**
   * Haversine distance in miles between two lat/lng points.
   */
  function haversineMiles(lat1, lng1, lat2, lng2) {
    const R = 3958.8; // Earth radius in miles
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ─── Public API functions ─────────────────────────────────────────────────────

  /**
   * Fetch all Boston hospitals.
   * @returns {Promise<Array<{name, address, lat, lng, neighborhood}>>}
   *
   * Source dataset: "Hospitals" (CSV)
   * Resource ID: 9ce5935a-bc4f-4a5c-a063-0f15fc01513a
   * Key fields: Name, Address, Latitude, Longitude, Zipcode
   */
  async function fetchHospitals() {
    console.log('[BostonAPI] fetchHospitals: fetching', RESOURCE_IDS.hospitals);
    try {
      const records = await _withTimeout(fetchAllRecords(RESOURCE_IDS.hospitals), 20000);
      return records
        .map((r) => ({
          name:         r.Name        || r.name        || '',
          address:      r.Address     || r.address     || '',
          lat:          parseFloat(r.Latitude  || r.POINT_Y || 0),
          lng:          parseFloat(r.Longitude || r.POINT_X || 0),
          phone:        r.PhoneNumbe  || r.Phone       || r.phone || r.PHONE || '',
          // The hospitals dataset doesn't carry a neighborhood field;
          // zip code is included as a lightweight proxy.
          neighborhood: r.Zipcode     || r.zipcode     || '',
        }))
        .filter((h) => h.name && h.lat !== 0 && h.lng !== 0);
    } catch (err) {
      console.error('[BostonAPI] fetchHospitals failed:', err);
      return [];
    }
  }

  /**
   * Fetch BPRD accessible park entrances, enriched with accessibility details
   * from the companion "BPRD Accessible Park Details" dataset.
   *
   * @returns {Promise<Array<{name, address, lat, lng, accessibility_notes}>>}
   *
   * Entrance source  : resource 2705f51f  — has park_name, y_latitude, x_longitude, address_for_gps
   * Details source   : resource 5dbfc0b1  — has stair_free, benches_wheelchair, accessible_play, etc.
   * Join key         : park_name (normalized to lower-case for a fuzzy join)
   */
  async function fetchAccessibleParks() {
    console.log('[BostonAPI] fetchAccessibleParks: fetching entrances', RESOURCE_IDS.parkEntrances);
    try {
      const [entrances, details] = await Promise.all([
        fetchAllRecords(RESOURCE_IDS.parkEntrances),
        fetchAllRecords(RESOURCE_IDS.parkDetails),
      ]);

      // Build a lookup map from park_name -> details record
      const detailMap = new Map();
      for (const d of details) {
        if (d.park_name) {
          detailMap.set(d.park_name.trim().toLowerCase(), d);
        }
      }

      return entrances
        .map((r) => {
          const lat = parseFloat(r.y_latitude  || 0);
          const lng = parseFloat(r.x_longitude || 0);
          const name = (r.park_name || '').trim();

          // Look up detail record for accessibility notes
          const detail = detailMap.get(name.toLowerCase()) || {};
          const notes = buildAccessibilityNotes(detail);

          return {
            name,
            address:              r.address_for_gps || '',
            lat,
            lng,
            accessibility_notes:  notes,
          };
        })
        .filter((p) => p.name && p.lat !== 0 && p.lng !== 0);
    } catch (err) {
      console.error('[BostonAPI] fetchAccessibleParks failed:', err);
      return [];
    }
  }

  /**
   * Build a human-readable accessibility notes string from a park detail record.
   * @param {Object} d — raw CKAN detail record
   * @returns {string}
   */
  function buildAccessibilityNotes(d) {
    const features = [];
    if (d.stair_free       === 'Y') features.push('Stair-free access');
    if (d.benches_wheelchair === 'Y') features.push('Wheelchair-accessible benches');
    if (d.table_wheelchair  === 'Y') features.push('Wheelchair-accessible tables');
    if (d.drinking_fountain === 'Y') features.push('Drinking fountain');
    if (d.bathroom          === 'Y') features.push('Accessible restroom');
    if (d.accessible_play)           features.push(`Accessible play: ${d.accessible_play}`);
    if (d.sensory_play)              features.push(`Sensory play: ${d.sensory_play}`);
    if (d.shaded_seating    === 'Y') features.push('Shaded seating');
    if (d.parking_type)              features.push(`Parking: ${d.parking_type}`);
    if (d.near_bus)                  features.push(`Near bus: ${d.near_bus}`);
    if (d.near_train)                features.push(`Near train: ${d.near_train}`);
    if (d.inclusion)                 features.push(`Inclusion: ${d.inclusion}`);
    return features.join('; ') || 'See BPRD for full accessibility details';
  }

  /**
   * Fetch recent 311 hazard complaints near a lat/lng point.
   *
   * Searches the current year and previous year resource IDs (2024–2026)
   * for case_title / type values matching fall/navigation keywords, then
   * filters results to within radiusMiles of the given point.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {number} [radiusMiles=0.5]
   * @returns {Promise<Array<{id, title, type, address, lat, lng, opened, status, neighborhood}>>}
   */
  async function fetch311Hazards(lat, lng, radiusMiles) {
    radiusMiles = radiusMiles || 0.5;
    try {
      // Keyword search on 2025 + 2026 resources in parallel, 1000 records each, 7s timeout.
      // SQL bbox strategy removed — unreliable (often disabled on CKAN) and slower.
      const resources = [RESOURCE_IDS.requests311_2026, RESOURCE_IDS.requests311_2025];
      const fetches   = resources.map(rid => _withTimeout(_fetch311Keyword(rid, 1000), 7000).catch(() => []));

      const seen = new Set();
      const allRecords = (await Promise.all(fetches))
        .flat()
        .filter(r => {
          const id = r.case_enquiry_id;
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });

      const kwLower = HAZARD_KEYWORDS.map(k => k.toLowerCase());
      return allRecords
        .filter(r => (r.case_status || '').toLowerCase() === 'open')
        .filter(r => {
          const title = (r.case_title || '').toLowerCase();
          const type  = (r.type       || '').toLowerCase();
          return kwLower.some(kw => title.includes(kw) || type.includes(kw));
        })
        .filter(r => {
          const rLat = parseFloat(r.latitude);
          const rLng = parseFloat(r.longitude);
          if (isNaN(rLat) || isNaN(rLng)) return false;
          return haversineMiles(lat, lng, rLat, rLng) <= radiusMiles;
        })
        .map(r => ({
          id:           r.case_enquiry_id || '',
          title:        r.case_title      || '',
          type:         r.type            || '',
          address:      r.location        || '',
          lat:          parseFloat(r.latitude),
          lng:          parseFloat(r.longitude),
          opened:       r.open_dt         || '',
          status:       r.case_status     || '',
          neighborhood: r.neighborhood    || '',
        }));
    } catch (err) {
      console.error('[BostonAPI] fetch311Hazards failed:', err);
      return [];
    }
  }

  async function _fetch311Keyword(rid, limit) {
    try {
      const params = new URLSearchParams({
        resource_id: rid,
        q:           'sidewalk pothole crosswalk curb ramp snow ice',
        limit,
        fields:      'case_enquiry_id,case_title,type,location,latitude,longitude,open_dt,case_status,neighborhood',
      });
      const res = await fetch(`${CKAN_BASE}?${params}`);
      if (!res.ok) return [];
      const json = await res.json();
      return (json && json.success && json.result) ? (json.result.records || []) : [];
    } catch (e) { return []; }
  }

  /**
   * Fetch Climate Ready Boston Social Vulnerability scores by neighborhood.
   *
   * @returns {Promise<Array<{
   *   neighborhood, population, older_adults, disabled, low_income,
   *   limited_english, people_of_color, vulnerability_score
   * }>>}
   *
   * Source dataset: "Climate Ready Boston Social Vulnerability" (CSV)
   * Resource ID   : 3d506197-74e9-4032-a455-fe231ea9daf1
   * Key fields    : Name, POP100_RE, OlderAdult, TotDis, Low_to_No, LEP, POC2, MedIllnes
   */
  async function fetchSocialVulnerability() {
    console.log('[BostonAPI] fetchSocialVulnerability: fetching', RESOURCE_IDS.socialVulnerability);
    try {
      const records = await fetchAllRecords(RESOURCE_IDS.socialVulnerability);
      return records
        .map((r) => {
          const pop        = parseFloat(r.POP100_RE)  || 0;
          const olderAdult = parseFloat(r.OlderAdult) || 0;
          const disabled   = parseFloat(r.TotDis)     || 0;
          const lowIncome  = parseFloat(r.Low_to_No)  || 0;
          const lep        = parseFloat(r.LEP)        || 0;
          const poc        = parseFloat(r.POC2)       || 0;
          const medIllness = parseFloat(r.MedIllnes)  || 0;

          // Compute a simple composite vulnerability score (0–100 scale).
          // Weighted toward factors most relevant to elderly residents:
          //   40% older adults, 20% disabled, 20% low income, 10% LEP, 10% illness
          const vulnScore = pop > 0
            ? Math.min(
                100,
                Math.round(
                  ((olderAdult / pop) * 40 +
                   (disabled   / pop) * 20 +
                   (lowIncome  / pop) * 20 +
                   (lep        / pop) * 10 +
                   (medIllness / pop) * 10) * 100
                )
              )
            : 0;

          return {
            neighborhood:      (r.Name || '').trim(),
            geoid:             r.GEOID10        || '',
            population:        pop,
            older_adults:      olderAdult,
            disabled:          disabled,
            low_income:        lowIncome,
            limited_english:   lep,
            people_of_color:   poc,
            median_illness:    medIllness,
            vulnerability_score: vulnScore,
          };
        })
        .filter((n) => n.neighborhood);
    } catch (err) {
      console.error('[BostonAPI] fetchSocialVulnerability failed:', err);
      return [];
    }
  }

  /**
   * Geocode a Boston address string to {lat, lng} using the free Nominatim API.
   * Appends ", Boston, MA, USA" if the string doesn't already mention Boston
   * to improve match accuracy.
   *
   * @param {string} address
   * @returns {Promise<{lat: number, lng: number}|null>}
   *   Returns null if geocoding fails or no result is found.
   */
  async function geocodeAddress(address) {
    console.log(`[BostonAPI] geocodeAddress: "${address}"`);
    try {
      // 1. US Census Bureau geocoder — most accurate for US street addresses
      const census = await censusFreeform(address);
      if (census) return census;
      // 2. Nominatim fallback
      const hasLocation = /,\s*[A-Z]{2}(\s+\d{5})?$/i.test(address) ||
        /boston|cambridge|somerville|brookline|quincy|newton|malden|roxbury/i.test(address);
      const query = hasLocation ? address : `${address}, Boston, MA`;
      return await nominatimFreeform(query);
    } catch (err) {
      console.error('[BostonAPI] geocodeAddress failed:', err);
      return null;
    }
  }

  async function censusFreeform(address) {
    try {
      const params = new URLSearchParams({
        address:   address,
        benchmark: 'Public_AR_Current',
        format:    'json',
      });
      const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      if (!res.ok) return null;
      const data = await res.json();
      const matches = data.result && data.result.addressMatches;
      if (!matches || !matches.length) return null;
      const m = matches[0];
      console.log('[BostonAPI] Census geocode match:', m.matchedAddress);
      return { lat: parseFloat(m.coordinates.y), lng: parseFloat(m.coordinates.x), approximate: true };
    } catch (err) {
      console.warn('[BostonAPI] Census geocoder failed, trying Nominatim:', err.message);
      return null;
    }
  }

  async function nominatimFreeform(query) {
    const params = new URLSearchParams({ q: query, format: 'json', limit: '1', countrycodes: 'us' });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`,
      { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.length) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), approximate: true };
  }

  /**
   * Search addresses across Massachusetts using the Photon geocoding API
   * (OpenStreetMap-based, no API key required).
   * Returns up to 8 matches with display label and lat/lng.
   *
   * @param {string} query — partial address string
   * @returns {Promise<Array<{label, street, city, state, zip, lat, lng}>>}
   */
  async function searchAddresses(query) {
    if (!query || query.length < 2) return [];
    try {
      // Massachusetts bounding box: W=-73.5, S=41.2, E=-69.9, N=42.9
      const params = new URLSearchParams({
        q:     query,
        limit: 8,
        bbox:  '-73.5,41.2,-69.9,42.9',
        lang:  'en',
      });
      const res = await fetch(`https://photon.komoot.io/api/?${params}`, {
        headers: { 'Accept-Language': 'en' },
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.features) return [];

      const MA_ABBR = { 'Massachusetts': 'MA', 'MA': 'MA' };

      return data.features
        .filter(f => f.geometry && f.geometry.coordinates)
        .map(f => {
          const p = f.properties || {};
          const stateRaw = p.state || '';
          const stateAbbr = MA_ABBR[stateRaw] || stateRaw;

          // Build street portion: prefer housenumber+street, else name, else street alone
          let street = '';
          if (p.housenumber && p.street) {
            street = p.housenumber + ' ' + p.street;
          } else if (p.street) {
            street = p.street;
          } else if (p.name) {
            street = p.name;
          }

          const city = p.city || p.town || p.village || p.county || '';
          const zip  = p.postcode || '';

          // Full label used in the input field when selected
          const cityState = [city, stateAbbr].filter(Boolean).join(', ');
          const label = [street, cityState, zip].filter(Boolean).join(', ');

          return {
            label,
            street,
            city,
            state: stateAbbr,
            zip,
            lat: f.geometry.coordinates[1],
            lng: f.geometry.coordinates[0],
          };
        })
        .filter(r => r.label && r.lat && r.lng);
    } catch (err) {
      console.error('[BostonAPI] searchAddresses failed:', err);
      return [];
    }
  }

  // Keep old name as alias for backwards compatibility
  const searchBostonAddresses = searchAddresses;

  // ─── ArcGIS helper ────────────────────────────────────────────────────────────

  async function _fetchArcGISGeoJSON(url) {
    const res = await _withTimeout(
      fetch(url + '&resultRecordCount=2000'),
      10000
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /**
   * Fetch Massachusetts Councils on Aging (Senior Centers) from MassGIS.
   * Covers all 350+ COAs across the state.
   * @returns {Promise<Array<{name, address, phone, website, lat, lng}>>}
   */
  async function fetchSeniorCenters() {
    console.log('[BostonAPI] fetchSeniorCenters');
    try {
      const data = await _fetchArcGISGeoJSON(
        'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/Councils_on_Aging/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson'
      );
      return (data.features || [])
        .filter(f => f.geometry && f.geometry.coordinates)
        .map(f => {
          const p = f.properties || {};
          const city  = p.CITY  || '';
          const state = p.STATE || 'MA';
          const zip   = p.ZIP   || '';
          const addr  = [p.ADDRESS, city, state + (zip ? ' ' + zip : '')].filter(Boolean).join(', ');
          return {
            name:    (p.LOCATION_NAME || 'Senior Center').trim(),
            address: addr,
            phone:   p.PHONE_NUMBER || '',
            website: p.WEBSITE      || '',
            lat:     f.geometry.coordinates[1],
            lng:     f.geometry.coordinates[0],
          };
        })
        .filter(c => c.lat && c.lng);
    } catch (err) {
      console.error('[BostonAPI] fetchSeniorCenters failed:', err);
      return [];
    }
  }

  /**
   * Fetch Massachusetts Community Health Centers from MassGIS.
   * Free / sliding-scale primary care clinics across the state.
   * @returns {Promise<Array<{name, address, phone, website, type, lat, lng}>>}
   */
  async function fetchCommunityHealthCenters() {
    console.log('[BostonAPI] fetchCommunityHealthCenters');
    try {
      const data = await _fetchArcGISGeoJSON(
        'https://arcgisserver.digital.mass.gov/arcgisserver/rest/services/AGOL/CommunityHealthCenters/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson'
      );
      return (data.features || [])
        .filter(f => f.geometry && f.geometry.coordinates)
        .map(f => {
          const p = f.properties || {};
          const city  = p.CITY  || '';
          const state = p.STATE || 'MA';
          const zip   = p.ZIP   || '';
          const addr  = [p.ADDRESS, city, state + (zip ? ' ' + zip : '')].filter(Boolean).join(', ');
          return {
            name:    (p.NAME || 'Health Center').trim(),
            address: addr,
            phone:   p.PHONE   || '',
            website: p.WEBSITE || '',
            type:    p.SERVICE_TYPE || '',
            lat:     f.geometry.coordinates[1],
            lng:     f.geometry.coordinates[0],
          };
        })
        .filter(c => c.lat && c.lng);
    } catch (err) {
      console.error('[BostonAPI] fetchCommunityHealthCenters failed:', err);
      return [];
    }
  }

  /**
   * Fetch Boston Community Centers (BCYF) from the City of Boston ArcGIS.
   * These centers offer senior programs, meals, fitness, and social activities.
   * @returns {Promise<Array<{name, address, phone, lat, lng}>>}
   */
  async function fetchCommunityCenters() {
    console.log('[BostonAPI] fetchCommunityCenters');
    try {
      const res = await fetch(
        'https://services.arcgis.com/sFnw0xNflSi8J0uh/arcgis/rest/services/Community_Centers/FeatureServer/0/query?where=1%3D1&outFields=*&f=json'
      );
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return (data.features || [])
        .filter(f => f.attributes && f.attributes.POINT_X && f.attributes.POINT_Y)
        .map(f => {
          const a   = f.attributes;
          const zip = a.ZIP ? ('0' + a.ZIP).slice(-5) : '';
          const addr = [a.STREET, (a.NEIGH || '') + ', Boston', 'MA' + (zip ? ' ' + zip : '')].filter(Boolean).join(', ');
          return {
            name:    (a.SITE || 'Community Center').trim(),
            address: addr,
            phone:   a.PHONE || '',
            lat:     a.POINT_Y,
            lng:     a.POINT_X,
          };
        })
        .filter(c => c.lat && c.lng);
    } catch (err) {
      console.error('[BostonAPI] fetchCommunityCenters failed:', err);
      return [];
    }
  }

  // ─── OSRM Routing ────────────────────────────────────────────────────────────
  // Walking uses routing.openstreetmap.de/routed-foot — a dedicated pedestrian
  // graph (uses sidewalks, paths, park cuts; avoids highways).
  // Driving uses router.project-osrm.org which only runs the car profile.

  const OSRM_FOOT_BASE    = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot';
  const OSRM_DRIVING_BASE = 'https://router.project-osrm.org/route/v1/driving';

  async function fetchOSRMRoute(fromLat, fromLng, toLat, toLng, profile) {
    profile = profile || 'foot';
    try {
      const coords = `${fromLng},${fromLat};${toLng},${toLat}`;
      const base = profile === 'foot' ? OSRM_FOOT_BASE : OSRM_DRIVING_BASE;
      const url = `${base}/${coords}?steps=true&overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes || !data.routes.length) return null;
      const route = data.routes[0];
      return {
        distance: route.distance,
        duration: route.duration,
        geometry: route.geometry,
        steps: (route.legs[0].steps || []).map(s => ({
          instruction: _buildOSRMInstruction(s),
          icon:        _getTurnIcon(s),
          distance:    s.distance,
          type:        s.maneuver.type,
        })),
      };
    } catch (err) {
      console.error('[BostonAPI] fetchOSRMRoute failed:', err);
      return null;
    }
  }

  function _buildOSRMInstruction(step) {
    const t = step.maneuver.type;
    const m = step.maneuver.modifier || '';
    const n = step.name || 'the road';
    if (t === 'depart')    return 'Head ' + (m || 'forward') + ' on ' + n;
    if (t === 'arrive')    return 'Arrive at destination';
    if (t === 'new name')  return 'Continue onto ' + n;
    if (t === 'continue')  return 'Continue on ' + n;
    if (t === 'merge')     return 'Merge onto ' + n;
    if (t === 'roundabout') return 'At roundabout, take exit onto ' + n;
    if (t === 'turn' || t === 'end of road' || t === 'fork') {
      if (m === 'left')         return 'Turn left onto ' + n;
      if (m === 'right')        return 'Turn right onto ' + n;
      if (m === 'slight left')  return 'Turn slightly left onto ' + n;
      if (m === 'slight right') return 'Turn slightly right onto ' + n;
      if (m === 'sharp left')   return 'Turn sharp left onto ' + n;
      if (m === 'sharp right')  return 'Turn sharp right onto ' + n;
      if (m === 'straight')     return 'Continue straight on ' + n;
      if (m === 'uturn')        return 'Make a U-turn on ' + n;
      return 'Turn onto ' + n;
    }
    return 'Continue to ' + n;
  }

  function _getTurnIcon(step) {
    const t = step.maneuver.type;
    const m = step.maneuver.modifier || '';
    if (t === 'arrive')   return '📍';
    if (t === 'depart')   return '🚶';
    if (m === 'uturn')    return '↩';
    if (m === 'left' || m === 'sharp left')   return '←';
    if (m === 'right' || m === 'sharp right') return '→';
    if (m === 'slight left')  return '↖';
    if (m === 'slight right') return '↗';
    return '↑';
  }

  // ─── MBTA Transit Routing ─────────────────────────────────────────────────────

  /**
   * Average transit speed in mph by MBTA route type.
   * 0=Light Rail, 1=Heavy Rail/Subway, 2=Commuter Rail, 3=Bus, 4=Ferry
   */
  function getTransitSpeed(routeType) {
    const speeds = { 0: 15, 1: 22, 2: 35, 3: 10, 4: 18 };
    return speeds[routeType] !== undefined ? speeds[routeType] : 10;
  }

  /**
   * Fetch MBTA routes that serve a specific stop.
   *
   * @param {string} stopId
   * @returns {Promise<Array<{id, name, longName, type, color}>>}
   */
  async function fetchMBTARoutesForStop(stopId) {
    try {
      const res = await fetch(
        `${MBTA_BASE}/routes?filter[stop]=${encodeURIComponent(stopId)}`,
        { headers: { Accept: 'application/vnd.api+json' } }
      );
      if (!res.ok) throw new Error(`MBTA routes HTTP ${res.status}`);
      const json = await res.json();
      return (json.data || []).map(r => ({
        id:       r.id,
        name:     r.attributes.short_name || r.attributes.long_name || r.id,
        longName: r.attributes.long_name || '',
        type:     r.attributes.type,
        color:    r.attributes.color || '1a3a5c',
      }));
    } catch (err) {
      console.error('[BostonAPI] fetchMBTARoutesForStop failed:', err);
      return [];
    }
  }

  /**
   * Plan an optimal transit itinerary:
   *   walk → best origin MBTA stop → [transit] → best dest MBTA stop → walk
   *
   * Tries up to 3 origin stops × 3 destination stops (9 combinations),
   * finds common routes for each pair, estimates total trip time using
   * route-type-specific speeds, and returns the minimum-time option.
   *
   * Returned time breakdown: walkToMins, waitMins, transitMins, walkFromMins, totalMins
   *
   * @param {number} fromLat
   * @param {number} fromLng
   * @param {number} toLat
   * @param {number} toLng
   * @returns {Promise<{
   *   originStop, destStop, originRoutes, commonRoutes, predictions,
   *   walkToStop, walkFromStop,
   *   walkToMins, waitMins, transitMins, walkFromMins, totalMins, transitDistMiles
   * }|null>}
   */
  async function planTransitRoute(fromLat, fromLng, toLat, toLng) {
    try {
      const [originStops, destStops] = await Promise.all([
        fetchMBTANearbyStops(fromLat, fromLng),
        fetchMBTANearbyStops(toLat, toLng),
      ]);
      if (!originStops.length) return null;

      const oStops = originStops.slice(0, 3);
      const dStops = destStops.slice(0, 3);

      // Fetch routes for all candidate stops in parallel
      const [oRouteArrays, dRouteArrays] = await Promise.all([
        Promise.all(oStops.map(s => fetchMBTARoutesForStop(s.id))),
        Promise.all(dStops.map(s => fetchMBTARoutesForStop(s.id))),
      ]);

      // Build candidates: pairs that share at least one route
      const candidates = [];
      oStops.forEach(function (oStop, oi) {
        dStops.forEach(function (dStop, di) {
          const oRoutes = oRouteArrays[oi];
          const dRouteIds = new Set(dRouteArrays[di].map(r => r.id));
          const common = oRoutes.filter(r => dRouteIds.has(r.id));

          const transitDistMiles = haversineMiles(oStop.lat, oStop.lng, dStop.lat, dStop.lng);
          const bestType = common.length > 0 ? common[0].type : 3;
          const transitMinsEst = transitDistMiles / getTransitSpeed(bestType) * 60;
          const walkToMinsEst  = oStop.distance / 3 * 60;
          const walkFromMinsEst = haversineMiles(dStop.lat, dStop.lng, toLat, toLng) / 3 * 60;

          candidates.push({
            oStop, dStop,
            oRoutes, dRoutes: dRouteArrays[di], common,
            transitDistMiles, transitMinsEst, walkToMinsEst, walkFromMinsEst,
            estimatedTotal: walkToMinsEst + 5 + transitMinsEst + walkFromMinsEst,
            hasCommonRoute: common.length > 0,
          });
        });
      });

      if (!candidates.length) return null;

      // Prefer pairs with common routes; within each group sort by estimated time
      candidates.sort(function (a, b) {
        if (a.hasCommonRoute !== b.hasCommonRoute) return a.hasCommonRoute ? -1 : 1;
        return a.estimatedTotal - b.estimatedTotal;
      });

      // Fetch OSRM + predictions + route shape for the top 2 candidates
      const top = candidates.slice(0, 2);
      const detailedResults = await Promise.all(top.map(async function (c) {
        const shapeRouteId = c.common.length > 0 ? c.common[0].id : null;
        const [walkToStop, walkFromStop, predictions, transitShape] = await Promise.all([
          fetchOSRMRoute(fromLat, fromLng, c.oStop.lat, c.oStop.lng),
          fetchOSRMRoute(c.dStop.lat, c.dStop.lng, toLat, toLng),
          fetchMBTAPredictions(c.oStop.id),
          shapeRouteId
            ? fetchMBTARouteShape(shapeRouteId, c.oStop.lat, c.oStop.lng, c.dStop.lat, c.dStop.lng)
            : Promise.resolve(null),
        ]);

        const relevantPreds = (c.common.length > 0
          ? predictions.filter(p => c.common.some(r => r.id === p.routeId))
          : predictions).slice(0, 5);

        const waitMins     = relevantPreds.length > 0 ? Math.max(0, relevantPreds[0].minutesAway) : 5;
        const walkToMins   = walkToStop   ? Math.round(walkToStop.duration  / 60) : Math.round(c.walkToMinsEst);
        const walkFromMins = walkFromStop ? Math.round(walkFromStop.duration / 60) : Math.round(c.walkFromMinsEst);
        const bestType     = c.common.length > 0 ? c.common[0].type : 3;
        const transitMins  = Math.round(c.transitDistMiles / getTransitSpeed(bestType) * 60);
        const totalMins    = walkToMins + waitMins + transitMins + walkFromMins;

        return Object.assign({}, c, {
          walkToStop, walkFromStop, transitShape,
          predictions: relevantPreds,
          walkToMins, waitMins, transitMins, walkFromMins, totalMins,
        });
      }));

      // Pick minimum total time
      detailedResults.sort(function (a, b) { return a.totalMins - b.totalMins; });
      const best = detailedResults[0];

      return {
        originStop:       best.oStop,
        destStop:         best.dStop,
        originRoutes:     best.oRoutes,
        commonRoutes:     best.common,
        predictions:      best.predictions,
        walkToStop:       best.walkToStop,
        walkFromStop:     best.walkFromStop,
        transitShape:     best.transitShape,   // actual route geometry (clipped)
        walkToMins:       best.walkToMins,
        waitMins:         best.waitMins,
        transitMins:      best.transitMins,
        walkFromMins:     best.walkFromMins,
        totalMins:        best.totalMins,
        transitDistMiles: best.transitDistMiles,
      };
    } catch (err) {
      console.error('[BostonAPI] planTransitRoute failed:', err);
      return null;
    }
  }

  // ─── MBTA Shape / Polyline helpers ───────────────────────────────────────────

  /**
   * Decode a Google Encoded Polyline string to [[lat, lng], ...] pairs.
   */
  function _decodePolyline(encoded) {
    var pts = [], i = 0, lat = 0, lng = 0;
    while (i < encoded.length) {
      var b, shift = 0, result = 0;
      do { b = encoded.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = encoded.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      pts.push([lat / 1e5, lng / 1e5]);
    }
    return pts;
  }

  /**
   * Fetch the MBTA route shape for a given route and clip it to the
   * portion between fromStop and toStop.
   *
   * Picks the shape variant (direction) that best fits the from→to direction,
   * then slices out the sub-segment closest to each stop.
   *
   * @param {string} routeId
   * @param {number} fromLat  origin stop lat
   * @param {number} fromLng  origin stop lng
   * @param {number} toLat    destination stop lat
   * @param {number} toLng    destination stop lng
   * @returns {Promise<GeoJSON.LineString|null>}
   */
  async function fetchMBTARouteShape(routeId, fromLat, fromLng, toLat, toLng) {
    try {
      const res = await fetch(
        `${MBTA_BASE}/shapes?filter[route]=${encodeURIComponent(routeId)}`,
        { headers: { Accept: 'application/vnd.api+json' } }
      );
      if (!res.ok) throw new Error(`MBTA shapes HTTP ${res.status}`);
      const json = await res.json();
      if (!json.data || !json.data.length) return null;

      var bestCoords = null;
      var bestScore  = Infinity;

      json.data.forEach(function (shape) {
        if (!shape.attributes || !shape.attributes.polyline) return;
        var pts = _decodePolyline(shape.attributes.polyline);
        if (pts.length < 2) return;

        // Find the index of the point closest to each stop
        var fi = 0, fd = Infinity, ti = 0, td = Infinity;
        pts.forEach(function (p, idx) {
          var df = haversineMiles(fromLat, fromLng, p[0], p[1]);
          var dt = haversineMiles(toLat,   toLng,   p[0], p[1]);
          if (df < fd) { fd = df; fi = idx; }
          if (dt < td) { td = dt; ti = idx; }
        });

        var score = fd + td;
        if (score < bestScore) {
          bestScore = score;
          // Slice the sub-segment; normalise so fi < ti
          var segment = (fi <= ti)
            ? pts.slice(fi, ti + 1)
            : pts.slice(ti, fi + 1).reverse();
          // GeoJSON coordinates are [lng, lat]
          bestCoords = segment.map(function (p) { return [p[1], p[0]]; });
        }
      });

      return bestCoords && bestCoords.length >= 2
        ? { type: 'LineString', coordinates: bestCoords }
        : null;
    } catch (err) {
      console.error('[BostonAPI] fetchMBTARouteShape failed:', err);
      return null;
    }
  }

  // ─── MBTA Live Data ──────────────────────────────────────────────────────────

  const MBTA_BASE = 'https://api-v3.mbta.com';

  /**
   * Fetch MBTA stops within a given radius of a lat/lng point.
   * radiusDeg defaults to 0.0072° ≈ 0.5 mi.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {number} [radiusDeg=0.0072]
   * @returns {Promise<Array<{id, name, lat, lng, distance}>>}
   */
  async function fetchMBTANearbyStops(lat, lng, radiusDeg) {
    radiusDeg = radiusDeg || 0.0072;
    try {
      const params = new URLSearchParams({
        'filter[latitude]':  lat,
        'filter[longitude]': lng,
        'filter[radius]':    radiusDeg.toString(),
      });
      const res = await fetch(`${MBTA_BASE}/stops?${params}`, {
        headers: { Accept: 'application/vnd.api+json' },
      });
      if (!res.ok) throw new Error(`MBTA stops HTTP ${res.status}`);
      const json = await res.json();
      return (json.data || [])
        .map(function (s) {
          return {
            id:       s.id,
            name:     (s.attributes && s.attributes.name) || s.id,
            lat:      s.attributes && s.attributes.latitude,
            lng:      s.attributes && s.attributes.longitude,
            distance: haversineMiles(lat, lng,
              s.attributes && s.attributes.latitude,
              s.attributes && s.attributes.longitude),
          };
        })
        .sort(function (a, b) { return a.distance - b.distance; })
        .slice(0, 8);
    } catch (err) {
      console.error('[BostonAPI] fetchMBTANearbyStops failed:', err);
      return [];
    }
  }

  /**
   * Fetch MBTA stops of a specific route type near a lat/lng point.
   * routeType: '0,1' = subway/light-rail, '3' = bus, '2' = commuter rail, etc.
   *
   * @param {number} lat
   * @param {number} lng
   * @param {string} routeType  GTFS route type(s), comma-separated
   * @param {number} [radiusDeg=0.015]
   * @returns {Promise<Array<{id, name, lat, lng, distance}>>}
   */
  async function fetchNearbyStopsByType(lat, lng, routeType, radiusDeg) {
    radiusDeg = radiusDeg || 0.015;
    try {
      const params = new URLSearchParams({
        'filter[latitude]':   lat,
        'filter[longitude]':  lng,
        'filter[radius]':     radiusDeg.toString(),
        'filter[route_type]': routeType,
      });
      const res = await fetch(`${MBTA_BASE}/stops?${params}`, {
        headers: { Accept: 'application/vnd.api+json' },
      });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data || [])
        .map(function (s) {
          return {
            id:       s.id,
            name:     (s.attributes && s.attributes.name) || s.id,
            lat:      s.attributes && s.attributes.latitude,
            lng:      s.attributes && s.attributes.longitude,
            distance: haversineMiles(lat, lng,
              s.attributes && s.attributes.latitude,
              s.attributes && s.attributes.longitude),
          };
        })
        .sort(function (a, b) { return a.distance - b.distance; });
    } catch (e) {
      console.error('[BostonAPI] fetchNearbyStopsByType failed:', e);
      return [];
    }
  }

  /**
   * Find stops served by a specific route that are near a lat/lng point.
   * Used to check whether a route actually reaches the destination area.
   *
   * @param {string} routeId
   * @param {number} lat
   * @param {number} lng
   * @param {number} [radiusDeg=0.015]   0.015° ≈ 1 mile
   * @returns {Promise<Array<{id, name, lat, lng, distance}>>}
   */
  async function fetchRouteStopsNearPoint(routeId, lat, lng, radiusDeg) {
    radiusDeg = radiusDeg || 0.015;
    try {
      const params = new URLSearchParams({
        'filter[route]':     routeId,
        'filter[latitude]':  lat,
        'filter[longitude]': lng,
        'filter[radius]':    radiusDeg.toString(),
      });
      const res = await fetch(`${MBTA_BASE}/stops?${params}`, {
        headers: { Accept: 'application/vnd.api+json' },
      });
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data || [])
        .map(function (s) {
          return {
            id:       s.id,
            name:     (s.attributes && s.attributes.name) || s.id,
            lat:      s.attributes && s.attributes.latitude,
            lng:      s.attributes && s.attributes.longitude,
            distance: haversineMiles(lat, lng,
              s.attributes && s.attributes.latitude,
              s.attributes && s.attributes.longitude),
          };
        })
        .sort(function (a, b) { return a.distance - b.distance; });
    } catch (err) {
      console.error('[BostonAPI] fetchRouteStopsNearPoint failed:', err);
      return [];
    }
  }

  /**
   * Fetch next predicted departures for a single MBTA stop.
   *
   * @param {string} stopId
   * @returns {Promise<Array<{routeName, routeId, departureTime, minutesAway}>>}
   */
  async function fetchMBTAPredictions(stopId) {
    try {
      const params = new URLSearchParams({
        'filter[stop]': stopId,
        'include':      'route,trip',
        'sort':         'departure_time',
        'page[limit]':  '5',
      });
      const res = await fetch(`${MBTA_BASE}/predictions?${params}`, {
        headers: { Accept: 'application/vnd.api+json' },
      });
      if (!res.ok) throw new Error(`MBTA predictions HTTP ${res.status}`);
      const json = await res.json();

      const routeMap = {};
      (json.included || []).forEach(inc => {
        if (inc.type === 'route') {
          routeMap[inc.id] = (inc.attributes.short_name) || (inc.attributes.long_name) || inc.id;
        }
      });

      const now = Date.now();
      return (json.data || [])
        .filter(p => p.attributes && (p.attributes.departure_time || p.attributes.arrival_time))
        .map(p => {
          const raw  = p.attributes.departure_time || p.attributes.arrival_time;
          const dt   = new Date(raw);
          const mins = Math.round((dt.getTime() - now) / 60000);
          const rid  = p.relationships.route && p.relationships.route.data && p.relationships.route.data.id;
          return {
            routeName:     rid ? (routeMap[rid] || rid) : '?',
            routeId:       rid || '',
            departureTime: dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            minutesAway:   mins,
          };
        })
        .filter(p => p.minutesAway >= 0)
        .slice(0, 5);
    } catch (err) {
      console.error('[BostonAPI] fetchMBTAPredictions failed:', err);
      return [];
    }
  }

  /**
   * Fetch all currently active MBTA vehicles (buses, light rail, subway).
   * Returns lat/lng, bearing, route info, and status for each vehicle.
   * No API key required. Filter by radius client-side.
   *
   * @returns {Promise<Array<{id, lat, lng, bearing, status, label,
   *   routeId, routeName, routeLongName, routeType, routeColor, routeTextColor}>>}
   */
  async function fetchMBTAVehicles(routeId) {
    try {
      const params = new URLSearchParams({
        'include': 'route',
        'page[limit]': '500',
      });
      if (routeId) {
        params.set('filter[route]', routeId);
      } else {
        params.set('filter[route_type]', '0,1,3');
      }
      const res = await fetch(`${MBTA_BASE}/vehicles?${params}`, {
        headers: { Accept: 'application/vnd.api+json' },
      });
      if (!res.ok) throw new Error(`MBTA vehicles HTTP ${res.status}`);
      const json = await res.json();

      const routeMap = {};
      (json.included || []).forEach(function (inc) {
        if (inc.type === 'route') {
          routeMap[inc.id] = {
            name:      inc.attributes.short_name || inc.attributes.long_name || inc.id,
            longName:  inc.attributes.long_name  || '',
            type:      inc.attributes.type,
            color:     inc.attributes.color      || '1a3a5c',
            textColor: inc.attributes.text_color || 'ffffff',
          };
        }
      });

      return (json.data || [])
        .filter(function (v) {
          return v.attributes && v.attributes.latitude && v.attributes.longitude;
        })
        .map(function (v) {
          const rid   = v.relationships.route && v.relationships.route.data && v.relationships.route.data.id;
          const route = rid ? (routeMap[rid] || {}) : {};
          return {
            id:             v.id,
            lat:            v.attributes.latitude,
            lng:            v.attributes.longitude,
            bearing:        v.attributes.bearing || 0,
            status:         v.attributes.current_status || '',
            label:          v.attributes.label || '',
            routeId:        rid || '',
            routeName:      route.name      || rid || '?',
            routeLongName:  route.longName  || '',
            routeType:      route.type      !== undefined ? route.type : 3,
            routeColor:     route.color     || '1a3a5c',
            routeTextColor: route.textColor || 'ffffff',
          };
        });
    } catch (err) {
      console.error('[BostonAPI] fetchMBTAVehicles failed:', err);
      return [];
    }
  }

  // ─── Overpass API ────────────────────────────────────────────────────────────

  async function _fetchOverpass(lat, lng, radiusMiles, tagSets) {
    const r = Math.round(radiusMiles * 1609.34);
    const parts = tagSets.map(function(tags) {
      const kv = Object.entries(tags).map(function(entry) {
        return '["' + entry[0] + '"="' + entry[1] + '"]';
      }).join('');
      return 'node' + kv + '(around:' + r + ',' + lat + ',' + lng + ');'
           + 'way'  + kv + '(around:' + r + ',' + lat + ',' + lng + ');';
    }).join('\n');
    const query = '[out:json][timeout:15];(\n' + parts + '\n);out center;';
    const res = await _withTimeout(fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: 'data=' + encodeURIComponent(query)
    }), 15000);
    if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
    const data = await res.json();
    return (data.elements || []).map(function(el) {
      const t = el.tags || {};
      return {
        name: t.name || t['name:en'] || '',
        address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || t['addr:full'] || '',
        phone: t.phone || t['contact:phone'] || t['phone:1'] || '',
        website: t.website || t['contact:website'] || '',
        lat: el.lat || (el.center && el.center.lat),
        lng: el.lon || (el.center && el.center.lon),
      };
    }).filter(function(p) { return p.lat && p.lng && p.name; });
  }

  async function fetchDentalClinics(lat, lng, radiusMiles) {
    try {
      return await _fetchOverpass(lat, lng, radiusMiles || 5, [
        { amenity: 'dentist' },
      ]);
    } catch (err) {
      console.error('[BostonAPI] fetchDentalClinics failed:', err);
      return [];
    }
  }

  async function fetchMentalHealth(lat, lng, radiusMiles) {
    try {
      return await _fetchOverpass(lat, lng, radiusMiles || 5, [
        { healthcare: 'psychiatry' },
        { healthcare: 'psychotherapist' },
        { healthcare: 'counselling' },
      ]);
    } catch (err) {
      console.error('[BostonAPI] fetchMentalHealth failed:', err);
      return [];
    }
  }

  async function fetchFoodPantries(lat, lng, radiusMiles) {
    try {
      return await _fetchOverpass(lat, lng, radiusMiles || 5, [
        { amenity: 'food_bank' },
        { social_facility: 'food_bank' },
      ]);
    } catch (err) {
      console.error('[BostonAPI] fetchFoodPantries failed:', err);
      return [];
    }
  }

  async function fetchFarmersMarkets(lat, lng, radiusMiles) {
    try {
      return await _fetchOverpass(lat, lng, radiusMiles || 5, [
        { amenity: 'marketplace' },
      ]);
    } catch (err) {
      console.error('[BostonAPI] fetchFarmersMarkets failed:', err);
      return [];
    }
  }

  async function fetchCoolingCenters(lat, lng, radiusMiles) {
    try {
      return await _fetchOverpass(lat, lng, radiusMiles || 5, [
        { amenity: 'cooling_centre' },
        { cooling_centre: 'yes' },
        { amenity: 'shelter', shelter_type: 'public' },
      ]);
    } catch (err) {
      console.error('[BostonAPI] fetchCoolingCenters failed:', err);
      return [];
    }
  }

  async function fetchWeatherAlerts(lat, lng) {
    try {
      const res = await _withTimeout(fetch(
        'https://api.weather.gov/alerts/active?point=' + lat + ',' + lng,
        { headers: { Accept: 'application/geo+json', 'User-Agent': 'BostonSeniorNavigator/1.0' } }
      ), 8000);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.features || [])
        .filter(function(f) { return /heat|cold|winter|freeze|wind.chill|frost/i.test(f.properties.event || ''); })
        .map(function(f) { return {
          event: f.properties.event || '',
          headline: f.properties.headline || f.properties.event || '',
          isHeat: /heat/i.test(f.properties.event || ''),
        }; });
    } catch (err) {
      return [];
    }
  }

  // ─── Export ───────────────────────────────────────────────────────────────────

  const BostonAPI = {
    fetchHospitals,
    fetchAccessibleParks,
    fetch311Hazards,
    fetchSocialVulnerability,
    geocodeAddress,
    searchAddresses,
    searchBostonAddresses,
    fetchSeniorCenters,
    fetchCommunityHealthCenters,
    fetchCommunityCenters,
    fetchOSRMRoute,
    fetchMBTANearbyStops,
    fetchMBTAPredictions,
    fetchMBTARoutesForStop,
    fetchMBTARouteShape,
    planTransitRoute,
    fetchMBTAVehicles,
    fetchRouteStopsNearPoint,
    fetchNearbyStopsByType,
    fetchDentalClinics,
    fetchMentalHealth,
    fetchFoodPantries,
    fetchFarmersMarkets,
    fetchCoolingCenters,
    fetchWeatherAlerts,

    // Expose constants for callers that want to do their own queries
    CKAN_BASE,
    RESOURCE_IDS,
    HAZARD_KEYWORDS,
  };

  global.BostonAPI = BostonAPI;

  // Also support ES module-style import if a bundler is ever introduced
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BostonAPI;
  }

})(typeof window !== 'undefined' ? window : this);
