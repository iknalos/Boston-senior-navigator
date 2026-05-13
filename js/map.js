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
    hospitals: null,
    parks: null,
    hazards: null,
    userLocation: null,
  };

  // The Leaflet layer-control instance (kept so we can re-add overlays)
  var _layerControl = null;

  // The user-location circle (kept separately so clearAll can remove it)
  var _userCircle = null;

  // ---------------------------------------------------------------------------
  // Helper: create a DivIcon with an emoji and an accessible label
  // ---------------------------------------------------------------------------
  function _makeEmojiIcon(emoji, size, extraClass) {
    size = size || 36;
    extraClass = extraClass || '';
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
      iconSize: [size, size],
      iconAnchor: [size / 2, size],
      popupAnchor: [0, -(size + 4)],
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
    _layers.hospitals = L.layerGroup().addTo(_map);
    _layers.parks = L.layerGroup().addTo(_map);
    _layers.hazards = L.layerGroup().addTo(_map);
    _layers.userLocation = L.layerGroup().addTo(_map);

    // Layer control (overlays only — no base-layer switcher needed)
    var overlays = {
      '<span style="font-size:16px;">&#127973; Hospitals</span>': _layers.hospitals,
      '<span style="font-size:16px;">&#127795; Accessible Parks</span>': _layers.parks,
      '<span style="font-size:16px;">&#9888;&#65039; 311 Hazards</span>': _layers.hazards,
      '<span style="font-size:16px;">&#127968; Your Location</span>': _layers.userLocation,
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
      L.marker([h.lat, h.lng], { icon: icon, alt: h.name || 'Hospital' })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(_layers.hospitals);
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
      L.marker([p.lat, p.lng], { icon: icon, alt: p.name || 'Accessible Park' })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(_layers.parks);
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

      var name = h.name || h.complaintType || 'Street Hazard';
      var desc = h.description || 'A hazard has been reported at this location. Please use caution.';

      // Extra metadata row showing complaint type and reported date
      var extraHtml = '';
      if (h.complaintType || h.date) {
        extraHtml += '<p class="bfm-popup-meta">';
        if (h.complaintType) {
          extraHtml += '<strong>Type:</strong> ' + _esc(h.complaintType);
        }
        if (h.complaintType && h.date) extraHtml += ' &nbsp;|&nbsp; ';
        if (h.date) {
          extraHtml += '<strong>Reported:</strong> ' + _esc(h.date);
        }
        extraHtml += '</p>';
      }

      var popup = _buildPopup(name, h.address, desc, extraHtml);
      L.marker([h.lat, h.lng], { icon: icon, alt: name })
        .bindPopup(popup, { maxWidth: 300 })
        .addTo(_layers.hazards);
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

    var icon = _makeEmojiIcon('🏠', 48, 'bfm-home-icon');

    var popupHtml = _buildPopup(
      'Your Searched Address',
      address || null,
      'This is the address you searched. The circle shows a 0.5-mile walking radius.'
    );

    L.marker([lat, lng], { icon: icon, alt: 'Your searched address', zIndexOffset: 1000 })
      .bindPopup(popupHtml, { maxWidth: 300 })
      .addTo(_layers.userLocation)
      .openPopup();

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
   * clearAll()
   * Removes all markers and the user-location circle from the map.
   * The base tile layer is unaffected.
   */
  function clearAll() {
    if (!_map) return;
    Object.keys(_layers).forEach(function (key) {
      if (_layers[key]) {
        _layers[key].clearLayers();
      }
    });
    if (_userCircle) {
      _map.removeLayer(_userCircle);
      _userCircle = null;
    }
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
    setUserLocation: setUserLocation,
    clearAll: clearAll,
    flyToLocation: flyToLocation,
  };

}(window));
