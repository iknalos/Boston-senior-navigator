/**
 * map.js — Age-Friendly Boston
 * Leaflet.js map module for locating hospitals, accessible parks,
 * 311 hazards, and a searched address near Boston, MA.
 *
 * Exposed on: window.BostonMap
 */

(function (global) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------
  var _map = null;

  // Layer groups for each data category
  var _layers = {
    hospitals:    null,
    parks:        null,
    hazards:      null,
    userLocation: null,
    transit:      null,   // live MBTA vehicle positions
    seniors:      null,   // Councils on Aging / Senior Centers
    health:       null,   // Community Health Centers
    community:    null,   // BCYF Community Centers
  };

  // The Leaflet layer-control instance (kept so we can re-add overlays)
  var _layerControl = null;

  // The user-location circle (kept separately so clearAll can remove it)
  var _userCircle = null;

  // Dashed hover polyline from home to a hovered resource
  var _hoverPolyline = null;

  // Route layers (walking/transit polylines drawn on click)
  var _routeLayers = [];

  // Live GPS marker
  var _liveMarker = null;

  // Marker registry for highlight-on-click: key "lat,lng" -> {marker, emoji, size}
  var _markerRegistry = {};
  var _highlightedEntry = null;

  // ---------------------------------------------------------------------------
  // Helper: stable registry key for a lat/lng pair
  // ---------------------------------------------------------------------------
  function _markerKey(lat, lng) {
    return parseFloat(lat).toFixed(5) + ',' + parseFloat(lng).toFixed(5);
  }

  // ---------------------------------------------------------------------------
  // Helper: create a DivIcon with an emoji and an accessible label
  // ---------------------------------------------------------------------------
  // anchorY: fraction of icon height where the pin point is (0=top, 1=bottom).
  // Default 0.5 (center) for resource markers; pass 1 for pin-style home marker.
  function _makeEmojiIcon(emoji, size, extraClass, anchorYFraction) {
    size = size || 36;
    extraClass = extraClass || '';
    var ay = typeof anchorYFraction === 'number' ? anchorYFraction : 0.5;
    var anchorY = Math.round(size * ay);
    return L.divIcon({
      html:
        '<span role="img" aria-label="' +
        emoji +
        '" style="font-size:' +
        size +
        'px;line-height:1;display:block;text-align:center;">' +
        emoji +
        '</span>',
      className: 'bfm-emoji-icon ' + extraClass,
      iconSize:    [size, size],
      iconAnchor:  [size / 2, anchorY],
      popupAnchor: [0, -(anchorY + 4)],
    });
  }

  // ---------------------------------------------------------------------------
  // Helper: build a common popup HTML string
  // ---------------------------------------------------------------------------
  function _buildPopup(name, address, description, extraHtml) {
    var html =
      '<div class="bfm-popup">' +
      '<strong class="bfm-popup-name">' + _esc(name) + '</strong>';
    if (address) {
      html += '<p class="bfm-popup-address">' + _esc(address) + '</p>';
    }
    if (description) {
      html += '<p class="bfm-popup-desc">' + _esc(description) + '</p>';
    }
    if (extraHtml) {
      html += extraHtml;
    }
    html += '</div>';
    return html;
  }

  // Minimal HTML-escape to avoid XSS in popup content
  function _esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------------
  // Helper: inject legend + popup CSS once
  // ---------------------------------------------------------------------------
  function _injectStyles() {
    if (document.getElementById('bfm-styles')) return;
    var style = document.createElement('style');
    style.id = 'bfm-styles';
    style.textContent = [
      /* Legend */
      '.bfm-legend {',
      '  background: #fff;',
      '  padding: 14px 18px;',
      '  border-radius: 8px;',
      '  box-shadow: 0 2px 8px rgba(0,0,0,0.3);',
      '  font-size: 18px;',
      '  line-height: 1.7;',
      '  color: #111;',
      '  min-width: 200px;',
      '}',
      '.bfm-legend h3 {',
      '  margin: 0 0 10px 0;',
      '  font-size: 20px;',
      '  font-weight: bold;',
      '  color: #000;',
      '  border-bottom: 2px solid #333;',
      '  padding-bottom: 6px;',
      '}',
      '.bfm-legend-row {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 10px;',
      '  margin-bottom: 4px;',
      '}',
      '.bfm-legend-icon {',
      '  font-size: 24px;',
      '  line-height: 1;',
      '  flex-shrink: 0;',
      '}',
      '.bfm-legend-label {',
      '  font-size: 17px;',
      '  color: #111;',
      '}',
      /* Popup */
      '.bfm-popup {',
      '  font-size: 16px;',
      '  line-height: 1.5;',
      '  max-width: 260px;',
      '  color: #111;',
      '}',
      '.bfm-popup-name {',
      '  display: block;',
      '  font-size: 18px;',
      '  font-weight: bold;',
      '  margin-bottom: 4px;',
      '  color: #000;',
      '}',
      '.bfm-popup-address {',
      '  margin: 0 0 4px 0;',
      '  color: #333;',
      '}',
      '.bfm-popup-desc {',
      '  margin: 0 0 4px 0;',
      '  color: #222;',
      '}',
      '.bfm-popup-meta {',
      '  margin: 4px 0 0 0;',
      '  font-size: 14px;',
      '  color: #555;',
      '}',
      /* Emoji icon wrapper */
      '.bfm-emoji-icon { background: none; border: none; }',
      /* Live transit vehicle badge */
      '.bfm-vehicle-icon { background: none; border: none; }',
      '.bfm-vehicle-badge {',
      '  border-radius: 50%;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  font-weight: 700;',
      '  border: 2px solid rgba(0,0,0,0.22);',
      '  box-shadow: 0 1px 4px rgba(0,0,0,0.45);',
      '  overflow: hidden;',
      '  line-height: 1;',
      '}',
      '.bfm-vehicle-badge--active {',
      '  border: 3px solid rgba(255,255,255,0.95);',
      '  animation: vehicle-pulse 1.4s ease-in-out infinite;',
      '}',
      '@keyframes vehicle-pulse {',
      '  0%,100% { box-shadow: 0 0 0 0 rgba(255,255,255,0.7), 0 2px 8px rgba(0,0,0,0.5); }',
      '  50%      { box-shadow: 0 0 0 7px rgba(255,255,255,0),  0 2px 8px rgba(0,0,0,0.5); }',
      '}',
      /* Highlighted marker — amber glow + scale up */
      '.bfm-highlight-icon span {',
      '  filter: drop-shadow(0 0 5px #f5a623) drop-shadow(0 0 10px #f5a62388);',
      '  display: block;',
      '}',
    ].join('\n');
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Helper: build and add the custom legend control
  // ---------------------------------------------------------------------------
  function _addLegend(map) {
    var Legend = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd: function () {
        var div = L.DomUtil.create('div', 'bfm-legend');
        div.setAttribute('role', 'region');
        div.setAttribute('aria-label', 'Map legend');
        div.innerHTML =
          '<h3>Map Key</h3>' +
          '<div class="bfm-legend-row">' +
          '  <span class="bfm-legend-icon" aria-hidden="true">&#127973;</span>' +
          '  <span class="bfm-legend-label">Hospital</span>' +
          '</div>' +
          '<div class="bfm-legend-row">' +
          '  <span class="bfm-legend-icon" aria-hidden="true">&#127795;</span>' +
          '  <span class="bfm-legend-label">Accessible Park</span>' +
          '</div>' +
          '<div class="bfm-legend-row">' +
          '  <span class="bfm-legend-icon" aria-hidden="true">&#9888;&#65039;</span>' +
          '  <span class="bfm-legend-label">311 Hazard</span>' +
          '</div>' +
          '<div class="bfm-legend-row">' +
          '  <span class="bfm-legend-icon" aria-hidden="true">&#127968;</span>' +
          '  <span class="bfm-legend-label">Your Location</span>' +
          '</div>' +
          '<div class="bfm-legend-row">' +
          '  <span class="bfm-legend-icon" aria-hidden="true">&#127963;</span>' +
          '  <span class="bfm-legend-label">Senior Center</span>' +
          '</div>' +
          '<div class="bfm-legend-row">' +
          '  <span class="bfm-legend-icon" aria-hidden="true">&#129658;</span>' +
          '  <span class="bfm-legend-label">Health Center</span>' +
          '</div>' +
          '<div class="bfm-legend-row">' +
          '  <span class="bfm-legend-icon" aria-hidden="true">&#127869;</span>' +
          '  <span class="bfm-legend-label">Community Center</span>' +
          '</div>';
        // Prevent map clicks from firing through the legend
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.disableScrollPropagation(div);
        return div;
      },
    });
    new Legend().addTo(map);
  }

  // ---------------------------------------------------------------------------
  // Helper: (re-)register a layer group with the layer control
  // ---------------------------------------------------------------------------
  function _registerOverlay(group, label) {
    if (_layerControl) {
      _layerControl.addOverlay(group, label);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * initMap(containerId)
   * Initialises the Leaflet map inside the given DOM element id.
   * Returns the Leaflet map instance.
   */
  function initMap(containerId) {
    _injectStyles();

    _map = L.map(containerId, {
      center: [42.3601, -71.0589],
      zoom: 13,
      zoomControl: true,
    });

    // OpenStreetMap base tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(_map);

    // Initialise empty layer groups and add them to the map
    _layers.hospitals    = L.layerGroup().addTo(_map);
    _layers.parks        = L.layerGroup().addTo(_map);
    _layers.hazards      = L.layerGroup().addTo(_map);
    _layers.userLocation = L.layerGroup().addTo(_map);
    _layers.transit      = L.layerGroup().addTo(_map);
    _layers.seniors      = L.layerGroup().addTo(_map);
    _layers.health       = L.layerGroup().addTo(_map);
    _layers.community    = L.layerGroup().addTo(_map);

    // Layer control (overlays only — no base-layer switcher needed)
    var overlays = {
      '<span style="font-size:16px;">&#127973; Hospitals</span>': _layers.hospitals,
      '<span style="font-size:16px;">&#127795; Accessible Parks</span>': _layers.parks,
      '<span style="font-size:16px;">&#9888;&#65039; 311 Hazards</span>': _layers.hazards,
      '<span style="font-size:16px;">&#127968; Your Location</span>': _layers.userLocation,
      '<span style="font-size:16px;">&#128652; Live Transit</span>': _layers.transit,
      '<span style="font-size:16px;">&#127963; Senior Centers</span>': _layers.seniors,
      '<span style="font-size:16px;">&#129658; Health Centers</span>': _layers.health,
      '<span style="font-size:16px;">&#127869; Community Centers</span>': _layers.community,
    };

    _layerControl = L.control.layers(null, overlays, {
      collapsed: false,
      position: 'topright',
    }).addTo(_map);

    _addLegend(_map);

    // Force Leaflet to remeasure container after CSS layout settles
    setTimeout(function () { _map.invalidateSize(); }, 200);

    return _map;
  }

  /**
   * plotHospitals(hospitals)
   * Expects an array of objects with the shape:
   * { name, address, lat, lng, description? }
   */
  function plotHospitals(hospitals) {
    if (!_map) { console.error('BostonMap: call initMap() first.'); return; }
    if (!Array.isArray(hospitals)) return;

    var icon = _makeEmojiIcon('🏥', 36, 'bfm-hospital-icon');

    hospitals.forEach(function (h) {
      if (h.lat == null || h.lng == null) return;
      var desc = h.description || 'This hospital provides medical services and emergency care.';
      var popup = _buildPopup(h.name, h.address, desc);
      var marker = L.marker([h.lat, h.lng], { icon: icon, alt: h.name || 'Hospital' })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(_layers.hospitals);
      _markerRegistry[_markerKey(h.lat, h.lng)] = { marker: marker, emoji: '🏥', cls: 'bfm-hospital-icon', size: 36 };
    });
  }

  /**
   * plotParks(parks)
   * Expects an array of objects with the shape:
   * { name, address, lat, lng, description? }
   */
  function plotParks(parks) {
    if (!_map) { console.error('BostonMap: call initMap() first.'); return; }
    if (!Array.isArray(parks)) return;

    var icon = _makeEmojiIcon('🌳', 36, 'bfm-park-icon');

    parks.forEach(function (p) {
      if (p.lat == null || p.lng == null) return;
      var desc = p.description || 'This park has wheelchair-accessible entrances and paved pathways.';
      var popup = _buildPopup(p.name, p.address, desc);
      var marker = L.marker([p.lat, p.lng], { icon: icon, alt: p.name || 'Accessible Park' })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(_layers.parks);
      _markerRegistry[_markerKey(p.lat, p.lng)] = { marker: marker, emoji: '🌳', cls: 'bfm-park-icon', size: 36 };
    });
  }

  /**
   * plotHazards(hazards)
   * Expects an array of objects with the shape:
   * { name?, address, lat, lng, complaintType?, date?, description? }
   */
  function plotHazards(hazards) {
    if (!_map) { console.error('BostonMap: call initMap() first.'); return; }
    if (!Array.isArray(hazards)) return;

    var icon = _makeEmojiIcon('⚠️', 34, 'bfm-hazard-icon');

    hazards.forEach(function (h) {
      if (h.lat == null || h.lng == null) return;

      var title  = h.title  || h.type  || 'Street Hazard';
      var type   = h.type   || '';
      var opened = h.opened || '';
      var status = h.status || '';

      // Format opened date nicely if available
      var dateStr = '';
      if (opened) {
        try { dateStr = new Date(opened).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }); }
        catch (e) { dateStr = opened.slice(0, 10); }
      }

      var extraHtml = '<p class="bfm-popup-meta">';
      if (type && type !== title) extraHtml += '<strong>Category:</strong> ' + _esc(type) + '<br>';
      if (dateStr)  extraHtml += '<strong>Reported:</strong> ' + _esc(dateStr) + '<br>';
      if (status)   extraHtml += '<strong>Status:</strong> '   + _esc(status);
      extraHtml += '</p>';

      var popup = _buildPopup('⚠️ ' + title, h.address || h.neighborhood || '', '', extraHtml);
      L.marker([h.lat, h.lng], { icon: icon, alt: title })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(_layers.hazards);
    });
  }

  /**
   * plotSeniorCenters(centers)
   * Expects: { name, address, phone, website, lat, lng }
   */
  function plotSeniorCenters(centers) {
    if (!_map) return;
    if (!Array.isArray(centers)) return;
    var icon = _makeEmojiIcon('🏛️', 34, 'bfm-seniors-icon');
    centers.forEach(function (c) {
      if (c.lat == null || c.lng == null) return;
      var extra = '';
      if (c.phone)   extra += '<p class="bfm-popup-meta"><strong>Phone:</strong> ' + _esc(c.phone) + '</p>';
      if (c.website) extra += '<p class="bfm-popup-meta"><a href="' + _esc(c.website) + '" target="_blank" rel="noopener">Website</a></p>';
      var popup = _buildPopup(c.name, c.address, 'Council on Aging — meals, activities, transportation & more.', extra);
      var marker = L.marker([c.lat, c.lng], { icon: icon, alt: c.name })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(_layers.seniors);
      _markerRegistry[_markerKey(c.lat, c.lng)] = { marker: marker, emoji: '🏛️', cls: 'bfm-seniors-icon', size: 34 };
    });
  }

  /**
   * plotHealthCenters(centers)
   * Expects: { name, address, phone, website, type, lat, lng }
   */
  function plotHealthCenters(centers) {
    if (!_map) return;
    if (!Array.isArray(centers)) return;
    var icon = _makeEmojiIcon('🩺', 34, 'bfm-health-icon');
    centers.forEach(function (c) {
      if (c.lat == null || c.lng == null) return;
      var extra = '';
      if (c.type)    extra += '<p class="bfm-popup-meta"><strong>Type:</strong> ' + _esc(c.type) + '</p>';
      if (c.phone)   extra += '<p class="bfm-popup-meta"><strong>Phone:</strong> ' + _esc(c.phone) + '</p>';
      if (c.website) extra += '<p class="bfm-popup-meta"><a href="' + _esc(c.website) + '" target="_blank" rel="noopener">Website</a></p>';
      var popup = _buildPopup(c.name, c.address, 'Free / sliding-scale primary care & preventive health services.', extra);
      var marker = L.marker([c.lat, c.lng], { icon: icon, alt: c.name })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(_layers.health);
      _markerRegistry[_markerKey(c.lat, c.lng)] = { marker: marker, emoji: '🩺', cls: 'bfm-health-icon', size: 34 };
    });
  }

  /**
   * plotCommunityCenters(centers)
   * Expects: { name, address, phone, lat, lng }
   */
  function plotCommunityCenters(centers) {
    if (!_map) return;
    if (!Array.isArray(centers)) return;
    var icon = _makeEmojiIcon('🍽️', 34, 'bfm-community-icon');
    centers.forEach(function (c) {
      if (c.lat == null || c.lng == null) return;
      var extra = '';
      if (c.phone) extra += '<p class="bfm-popup-meta"><strong>Phone:</strong> ' + _esc(c.phone) + '</p>';
      var popup = _buildPopup(c.name, c.address, 'Boston community center — senior programs, free meals & fitness.', extra);
      var marker = L.marker([c.lat, c.lng], { icon: icon, alt: c.name })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(_layers.community);
      _markerRegistry[_markerKey(c.lat, c.lng)] = { marker: marker, emoji: '🍽️', cls: 'bfm-community-icon', size: 34 };
    });
  }

  /**
   * setUserLocation(lat, lng, address)
   * Drops a large home marker and draws a 0.5-mile (~804 m) radius circle.
   * Clears any previous user-location markers first.
   */
  function setUserLocation(lat, lng, address) {
    if (!_map) { console.error('BostonMap: call initMap() first.'); return; }

    // Clear previous user location
    _layers.userLocation.clearLayers();
    if (_userCircle) {
      _map.removeLayer(_userCircle);
      _userCircle = null;
    }

    // 42 px, anchored at the BOTTOM so the house base sits on the coordinate
    var icon = _makeEmojiIcon('🏠', 42, 'bfm-home-icon', 1.0);

    var popupHtml = _buildPopup(
      'Your Location',
      address || null,
      'The circle shows a 0.5-mile walking radius.'
    );

    L.marker([lat, lng], { icon: icon, alt: 'Your location', zIndexOffset: 1000 })
      .bindPopup(popupHtml, { maxWidth: 300 })
      .addTo(_layers.userLocation);

    // 0.5 mile = 804.672 metres
    _userCircle = L.circle([lat, lng], {
      radius: 804.672,
      color: '#1a73e8',
      weight: 2,
      opacity: 0.8,
      fillColor: '#1a73e8',
      fillOpacity: 0.08,
    }).addTo(_map);
  }

  /**
   * drawRoute(geojsonGeometry, color, dashed)
   * Draws a GeoJSON LineString on the map and stores the layer.
   * Call fitRoutes() after all segments are drawn.
   */
  function drawRoute(geojsonGeometry, color, dashed) {
    if (!_map || !geojsonGeometry) return;
    var layer = L.geoJSON(geojsonGeometry, {
      style: {
        color:     color || '#1a73e8',
        weight:    5,
        opacity:   0.85,
        dashArray: dashed ? '10 6' : null,
        lineCap:   'round',
        lineJoin:  'round',
      },
    }).addTo(_map);
    _routeLayers.push(layer);
  }

  /**
   * clearRoute()
   * Removes all route polylines added by drawRoute().
   */
  function clearRoute() {
    _routeLayers.forEach(function (layer) {
      if (_map) _map.removeLayer(layer);
    });
    _routeLayers = [];
  }

  /**
   * fitRoutes()
   * Fits the map viewport to show all drawn route layers plus the home marker.
   */
  function fitRoutes() {
    if (!_map) return;
    var bounds = L.latLngBounds([]);
    _routeLayers.forEach(function (layer) {
      try { bounds.extend(layer.getBounds()); } catch (e) {}
    });
    var origin = _getUserLatLng();
    if (origin) bounds.extend(L.latLng(origin[0], origin[1]));
    if (bounds.isValid()) {
      _map.fitBounds(bounds, { padding: [50, 50], maxZoom: 17 });
    }
  }

  /**
   * setLivePosition(lat, lng)
   * Creates or moves the pulsing blue GPS dot.
   */
  function setLivePosition(lat, lng) {
    if (!_map) return;
    if (_liveMarker) {
      _liveMarker.setLatLng([lat, lng]);
    } else {
      var icon = L.divIcon({
        html: '<div class="live-dot"></div>',
        className: 'live-dot-wrapper',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      _liveMarker = L.marker([lat, lng], { icon: icon, zIndexOffset: 3000 }).addTo(_map);
    }
  }

  /**
   * clearLivePosition()
   * Removes the GPS dot.
   */
  function clearLivePosition() {
    if (_liveMarker && _map) {
      _map.removeLayer(_liveMarker);
      _liveMarker = null;
    }
  }

  /**
   * panToLive(lat, lng)
   * Smoothly pans the map to keep the live dot centred.
   */
  function panToLive(lat, lng) {
    if (!_map) return;
    _map.panTo([lat, lng], { animate: true, duration: 0.6, easeLinearity: 0.5 });
  }

  /**
   * updateRouteProgress(allCoords, fromIndex)
   * Redraws the route split at fromIndex:
   *   completed portion → grey
   *   remaining portion → bright blue
   * allCoords is an array of GeoJSON [lng, lat] pairs.
   */
  function updateRouteProgress(allCoords, fromIndex) {
    clearRoute();
    if (fromIndex > 0) {
      drawRoute(
        { type: 'LineString', coordinates: allCoords.slice(0, fromIndex + 1) },
        '#9e9e9e', false
      );
    }
    if (fromIndex < allCoords.length - 1) {
      drawRoute(
        { type: 'LineString', coordinates: allCoords.slice(fromIndex) },
        '#1a73e8', false
      );
    }
  }

  /**
   * drawHoverLine(destLat, destLng)
   * Draws a dashed polyline from the user's home marker to the destination
   * and fits the map to show both points smoothly.
   */
  function drawHoverLine(destLat, destLng) {
    if (!_map) return;
    clearHoverLine();
    var origin = _getUserLatLng();
    if (!origin) return;
    _hoverPolyline = L.polyline(
      [origin, [destLat, destLng]],
      { color: '#1a73e8', weight: 4, opacity: 0.85, dashArray: '10 6' }
    ).addTo(_map);
    // Fit the viewport to show both user home and the hovered destination
    _map.fitBounds(
      L.latLngBounds([origin, [destLat, destLng]]),
      { padding: [70, 70], maxZoom: 17, animate: true, duration: 0.35 }
    );
  }

  /**
   * clearHoverLine()
   * Removes the dashed hover polyline if present.
   */
  function clearHoverLine() {
    if (_hoverPolyline && _map) {
      _map.removeLayer(_hoverPolyline);
      _hoverPolyline = null;
    }
  }

  /**
   * highlightMarker(lat, lng)
   * Enlarges and adds an amber glow to the marker at the given coords,
   * and opens its popup. Clears any previous highlight first.
   */
  function highlightMarker(lat, lng) {
    clearHighlight();
    var key = _markerKey(lat, lng);
    var entry = _markerRegistry[key];
    if (!entry) return;
    _highlightedEntry = entry;
    var bigIcon = _makeEmojiIcon(entry.emoji, 50, entry.cls + ' bfm-highlight-icon');
    entry.marker.setIcon(bigIcon);
    entry.marker.openPopup();
  }

  /**
   * clearHighlight()
   * Restores the previously highlighted marker to its default size.
   */
  function clearHighlight() {
    if (!_highlightedEntry) return;
    var e = _highlightedEntry;
    e.marker.setIcon(_makeEmojiIcon(e.emoji, e.size, e.cls));
    e.marker.closePopup();
    _highlightedEntry = null;
  }

  function _getUserLatLng() {
    if (!_layers.userLocation) return null;
    var latlng = null;
    _layers.userLocation.eachLayer(function (layer) {
      if (layer instanceof L.Marker) {
        latlng = [layer.getLatLng().lat, layer.getLatLng().lng];
      }
    });
    return latlng;
  }

  // ---------------------------------------------------------------------------
  // Live transit vehicle helpers
  // ---------------------------------------------------------------------------

  // Known MBTA rail route abbreviations (short_name is empty for these)
  var _RAIL_ABBREV = {
    'Red Line': 'RL', 'Orange Line': 'OL', 'Blue Line': 'BL',
    'Green Line': 'GL', 'Green Line B': 'GB', 'Green Line C': 'GC',
    'Green Line D': 'GD', 'Green Line E': 'GE',
    'Silver Line Way': 'SL', 'SL1': 'SL1', 'SL2': 'SL2', 'SL3': 'SL3',
    'SL4': 'SL4', 'SL5': 'SL5', 'Mattapan Trolley': 'MT',
  };

  function _vehicleLabel(routeName, routeType) {
    if (!routeName || routeName === '?') return '?';
    if (routeType === 0 || routeType === 1) {
      return _RAIL_ABBREV[routeName] || routeName.slice(0, 2).toUpperCase();
    }
    return routeName.length > 4 ? routeName.slice(0, 4) : routeName;
  }

  function _makeVehicleIcon(routeName, routeType, bgColor, textColor, active) {
    var label = _vehicleLabel(routeName, routeType);
    var bg    = bgColor    && bgColor    !== '000000' ? '#' + bgColor    : '#1a3a5c';
    var fg    = textColor  && textColor  !== '000000' ? '#' + textColor  : '#ffffff';
    var sz    = active ? 34 : ((routeType === 0 || routeType === 1) ? 26 : 22);
    var fs    = active ? '12px' : (sz <= 22 ? '9px' : '10px');
    var cls   = 'bfm-vehicle-badge' + (active ? ' bfm-vehicle-badge--active' : '');
    return L.divIcon({
      html: '<div class="' + cls + '" style="background:' + bg + ';color:' + fg
          + ';width:' + sz + 'px;height:' + sz + 'px;font-size:' + fs + ';">'
          + label + '</div>',
      className: 'bfm-vehicle-icon',
      iconSize:   [sz, sz],
      iconAnchor: [sz / 2, sz / 2],
      popupAnchor: [0, -(sz / 2 + 2)],
    });
  }

  /**
   * plotTransitVehicles(vehicles)
   * Clears the transit layer and re-draws all vehicle badges.
   * Each vehicle shows a colored route-badge marker; clicking opens a popup.
   */
  function plotTransitVehicles(vehicles, activeMode) {
    if (!_map) return;
    _layers.transit.clearLayers();
    if (!vehicles || !vehicles.length) return;

    vehicles.forEach(function (v) {
      if (!v.lat || !v.lng) return;
      var icon = _makeVehicleIcon(v.routeName, v.routeType, v.routeColor, v.routeTextColor, activeMode);
      var status = (v.status || '').replace(/_/g, ' ').toLowerCase();
      var popup =
        '<div class="bfm-popup">' +
        '<strong class="bfm-popup-name">' + _esc(v.routeName) + '</strong>' +
        (v.routeLongName ? '<p class="bfm-popup-address">' + _esc(v.routeLongName) + '</p>' : '') +
        '<p class="bfm-popup-desc">Vehicle #' + _esc(v.label) + '</p>' +
        (status ? '<p class="bfm-popup-meta">' + status + '</p>' : '') +
        '</div>';
      L.marker([v.lat, v.lng], { icon: icon, zIndexOffset: activeMode ? 1000 : 500 })
        .bindPopup(popup, { maxWidth: 220 })
        .addTo(_layers.transit);
    });
  }

  /**
   * clearAll()
   * Removes all markers and the user-location circle from the map.
   * The base tile layer is unaffected.
   */
  function clearAll() {
    if (!_map) return;
    clearHighlight();
    _markerRegistry = {};
    Object.keys(_layers).forEach(function (key) {
      if (_layers[key]) {
        _layers[key].clearLayers();
      }
    });
    if (_userCircle) {
      _map.removeLayer(_userCircle);
      _userCircle = null;
    }
    clearHoverLine();
    clearRoute();
  }

  /**
   * flyToLocation(lat, lng)
   * Smoothly pans and zooms the map to the given coordinates.
   */
  function flyToLocation(lat, lng) {
    if (!_map) { console.error('BostonMap: call initMap() first.'); return; }
    _map.flyTo([lat, lng], 15, {
      animate: true,
      duration: 1.2,
    });
  }

  // ---------------------------------------------------------------------------
  // Expose public API
  // ---------------------------------------------------------------------------
  global.BostonMap = {
    initMap: initMap,
    plotHospitals: plotHospitals,
    plotParks: plotParks,
    plotHazards: plotHazards,
    plotSeniorCenters: plotSeniorCenters,
    plotHealthCenters: plotHealthCenters,
    plotCommunityCenters: plotCommunityCenters,
    setUserLocation: setUserLocation,
    clearAll: clearAll,
    flyToLocation: flyToLocation,
    drawHoverLine: drawHoverLine,
    clearHoverLine: clearHoverLine,
    highlightMarker: highlightMarker,
    clearHighlight: clearHighlight,
    plotTransitVehicles: plotTransitVehicles,
    drawRoute: drawRoute,
    clearRoute: clearRoute,
    fitRoutes: fitRoutes,
    setLivePosition: setLivePosition,
    clearLivePosition: clearLivePosition,
    panToLive: panToLive,
    updateRouteProgress: updateRouteProgress,
  };

}(window));
