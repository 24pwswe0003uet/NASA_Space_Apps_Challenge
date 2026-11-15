/* District exploration component.
   Shows a dedicated district experience after province-level selection.
   Integrates with existing Leaflet map, state management, and data service.
   Placeholder states clearly indicate "not yet connected" without presenting
   fake values. All integration points ready for backend data contract. */

/* eslint-enviroment browser, es6 */

(window.Atlas = window.Atlas || {}).components = (window.Atlas.components || {});

Atlas.components.district = (function () {
  'use strict';

  var util = Atlas.util;
  var el = util.el;
  var t = Atlas.i18n.t;
  var cfg = Atlas.config;
  var state = Atlas.state;
  var Layers = window.AtlasLayers;
  var LayerControl = window.AtlasLayerControl;
  var csv = Atlas.csv;

  var districtMeta = null;
  var agriculturalStats = null;
  var environmentalStats = null;
  var timeSeriesData = null;
  var chartPromise = null;

  function render() {
    var did = state.districtId;
    if (!did) return;

    // --- District Header ---
    var dFeature = null;
    var districts = Atlas.data.getMeta ? Atlas.data.getMeta().districts : null;
    if (districts) {
      dFeature = districts.features.filter(function (f) { return f.properties.district_id === did; })[0];
    }

    var header = document.createElement('div');
    header.className = 'district-header';

    if (dFeature) {
      var dName = dFeature.properties.district_name_en || dFeature.properties.district_id || t('district_unknown');
      header.innerHTML =
        '<div class="district-name">' + t('district', { name: dName }) + '</div>' +
        '<div class="district-code">' + (dFeature.properties.district_id || '') + '</div>' +
        '<div class="district-nav">' +
          '<button class="btn back" onclick="Atlas.components.district.backToProvince()">' + t('province') + '</button>' +
        '</div>';
    } else {
      header.innerHTML =
        '<div class="district-name">' + t('district_loading') + '</div>' +
        '<div class="district-nav">' +
          '<button class="btn back" onclick="Atlas.components.district.backToProvince()">' + t('province') + '</button>' +
        '</div>';
    }

    // --- District Map ---
    var mapDiv = document.createElement('div');
    mapDiv.className = 'district-map';
    mapDiv.innerHTML =
      '<div class="map-controls">' +
        '<button class="btn reset" onclick="Atlas.map.resetDistrictView()">' + t('reset_view') + '</button>' +
      '</div>' +
      '<div id="district-map-canvas"></div>';

    // --- District Overview ---
    var overview = document.createElement('div');
    overview.className = 'district-overview';
    overview.innerHTML =
      '<h2 class="section-title">' + t('district_overview') + '</h2>' +
      '<div class="stats-grid" id="district-stats">' +
        '<div class="stat-item loading">' +
          '<span class="stat-label">' + t('loading') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="environmental-stats loading" id="env-stats">' +
        '<span class="stat-label">' + t('loading') + '</span>' +
      '</div>';

    // --- Chart placeholder ---
    var chartDiv = document.createElement('div');
    chartDiv.className = 'district-chart';
    chartDiv.innerHTML =
      '<h2 class="section-title">' + t('chart_title') + '</h2>' +
      '<div class="chart-placeholder">' +
        '<p class="hint">' + t('no_series_no_data') + '</p>' +
        '<p class="hint small">' + t('data_pending_district', { district: t('unknown') }) + '</p>' +
      '</div>';

    // Render
    var panel = document.getElementById('panel');
    if (panel) {
      panel.innerHTML = '';
      var inner = document.createElement('div');
      inner.className = 'panel-inner';
      panel.appendChild(inner);
      inner.appendChild(header);
      inner.appendChild(mapDiv);
      inner.appendChild(overview);
      inner.appendChild(chartDiv);
      Atlas.motion.reveal(inner);
    }
  }

  /* ---- Back navigation ---- */
  function backToProvince() {
    state.level = 'province';
    state.districtId = null;
    state.ucId = null;
    Atlas.components.states.render();
    Atlas.map.resetProvinceView();
  }

  /* ---- Initialization ---- */
  function init() {
    if (state.level === 'district' && state.districtId) {
      render();
    }
  }

  return { render: render, init: init, backToProvince: backToProvince };
})();