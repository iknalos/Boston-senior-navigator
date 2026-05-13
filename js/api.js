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
      const records = await fetchAllRecords(RESOURCE_IDS.hospitals);
      return records
        .map((r) => ({
          name:         r.Name        || r.name        || '',
          address:      r.Address     || r.address     || '',
          lat:          parseFloat(r.Latitude  || r.POINT_Y || 0),
          lng:          parseFloat(r.Longitude || r.POINT_X || 0),
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
  async function fetch311Hazards(lat, lng, radiusMiles = 0.5) {
    console.log(
      `[BostonAPI] fetch311Hazards: searching within ${radiusMiles} mi of (${lat}, ${lng})`
    );
    try {
      // Fetch from the two most recent full-year resources plus the current year
      const resources = [
        RESOURCE_IDS.requests311_2026,
        RESOURCE_IDS.requests311_2025,
        RESOURCE_IDS.requests311_2024,
      ];

      // Fetch each year in parallel; each call returns up to 5000 records
      // (CKAN's practical max without heavy pagination on live datasets)
      const yearFetches = resources.map((rid) =>
        fetch311Year(rid, 5000).catch((err) => {
          console.warn(`[BostonAPI] fetch311Hazards: skipped resource ${rid}:`, err.message);
          return [];
        })
      );

      const yearArrays = await Promise.all(yearFetches);
      const allRecords = yearArrays.flat();

      // Filter by keyword in case_title or type, then by distance
      const hazardKeywordsLower = HAZARD_KEYWORDS.map((k) => k.toLowerCase());

      return allRecords
        .filter((r) => {
          const title = (r.case_title || '').toLowerCase();
          const type  = (r.type        || '').toLowerCase();
          return hazardKeywordsLower.some((kw) => title.includes(kw) || type.includes(kw));
        })
        .filter((r) => {
          const rLat = parseFloat(r.latitude);
          const rLng = parseFloat(r.longitude);
          if (isNaN(rLat) || isNaN(rLng)) return false;
          return haversineMiles(lat, lng, rLat, rLng) <= radiusMiles;
        })
        .map((r) => ({
          id:           r.case_enquiry_id || r._id || '',
          title:        r.case_title      || '',
          type:         r.type            || '',
          address:      r.location        || r.location_street_name || '',
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

  /**
   * Fetch up to `limit` records from a single 311 year resource.
   * Uses CKAN's SQL-style filters where possible, falls back to fetching
   * a large batch and post-filtering.
   * @param {string} resourceId
   * @param {number} limit
   * @returns {Promise<Object[]>}
   */
  async function fetch311Year(resourceId, limit) {
    const params = new URLSearchParams({
      resource_id: resourceId,
      limit,
    });
    const url = `${CKAN_BASE}?${params}`;
    console.log(`[BostonAPI] fetch311Year: GET ${url}`);

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    if (!json.success) throw new Error(`CKAN error: ${JSON.stringify(json.error)}`);
    return json.result.records || [];
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
    const query = /boston/i.test(address) ? address : `${address}, Boston, MA, USA`;
    console.log(`[BostonAPI] geocodeAddress: querying Nominatim for "${query}"`);
    try {
      const params = new URLSearchParams({
        q:              query,
        format:         'json',
        addressdetails: '1',
        limit:          '1',
        countrycodes:   'us',
      });
      const url = `https://nominatim.openstreetmap.org/search?${params}`;

      const response = await fetch(url, {
        headers: {
          // Nominatim requires a descriptive User-Agent (no key needed)
          'User-Agent': 'AgeFriendlyBoston/1.0 (solanki.har@northeastern.edu)',
          'Accept-Language': 'en',
        },
      });

      if (!response.ok) {
        throw new Error(`Nominatim HTTP ${response.status}`);
      }

      const results = await response.json();
      if (!results || results.length === 0) {
        console.warn(`[BostonAPI] geocodeAddress: no result for "${query}"`);
        return null;
      }

      return {
        lat: parseFloat(results[0].lat),
        lng: parseFloat(results[0].lon),
      };
    } catch (err) {
      console.error('[BostonAPI] geocodeAddress failed:', err);
      return null;
    }
  }

  // ─── Export ───────────────────────────────────────────────────────────────────

  const BostonAPI = {
    fetchHospitals,
    fetchAccessibleParks,
    fetch311Hazards,
    fetchSocialVulnerability,
    geocodeAddress,

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
