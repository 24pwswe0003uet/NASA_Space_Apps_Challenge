/* Union Council information panel.
   Shows detailed UC information including agricultural and environmental measurements.
   Integrates with existing state, data service, and chart architecture.
   Placeholder states indicate "not yet connected" without fake values.
   All integration points ready for confirmed data contract. */

/* eslint-enviroment browser, es6 */

(window.Atlas = window.Atlas || {}).components = (window.Atlas.components || {});

Atlas.components.ucPanel = (function () {
  'use strict';

  var util = Atlas.util;
  var el = util.el;
  var t = Atlas.i18n.t;
  var cfg = Atlas.config;
  var state = Atlas.state;
  var Layers = window.AtlasLayers;
  var csv = Atlas.csv;

  var ucFeature = null;
  var seriesData = null;

  function render() {
    var ucId = state.ucId;
    var did = state.districtId;
    if (!ucId || !did) return;

    // Find the UC feature from loaded UCs
    var fc = Atlas.data.loadUCs(did);
    if (fc && fc.features) {
      ucFeature = fc.features.filter(function (f) { return f.properties.uc_id === ucId; })[0];
    }

    var panel = document.getElementById('panel');
    if (!panel) return;

    var inner = Atlas.components.states.panelShell();

    // --- Crumbs/Navigation ---
    var crumbs = document.createElement('div');
    crumbs.className = 'crumbs';
    crumbs.innerHTML =
      '<button class="btn back" onclick="Atlas.components.ucPanel.backToProvince()">' + t('province') + '</button>' +
      '<span class="here">' + (ucFeature ? ucFeature.properties.uc_name_en : t('uc_unknown')) + '</span>' +
      '<icon name="chevron-right" class="icon-sm"></icon>' +
      '<button class="btn" onclick="Atlas.components.ucPanel.backToDistrict()">' + t('district') + '</button>';
    inner.appendChild(crumbs);

    // --- UC Identification ---
    var idSection = document.createElement('div');
    idSection.className = 'uc-identification';
    idSection.innerHTML =
      '<h2>' + t('uc_identification') + '</h2>' +
      '<div class="id-row">' +
        '<div class="id-field">' + t('uc_name') + ': ' + (ucFeature ? ucFeature.properties.uc_name_en || ucFeature.properties.uc_name : t('uc_unknown')) + '</div>' +
        '<div class="id-field">' + t('district') + ': ' + (state.districtId ? Atlas.data.districtService.districtMeta(state.districtId).nameEn : t('unknown')) + '</div>' +
      '</div>' +
      (ucFeature && ucFeature.properties.uc_id ?
        '<div class="id-field">' + t('geographic_identifier') + ': ' + ucFeature.properties.uc_id : '') +
      (ucFeature && ucFeature.properties.observation_period ?
        '<div class="id-field">' + t('observation_period') + ': ' + ucFeature.properties.observation_period : '') +
      '</div>';
    inner.appendChild(idSection);

    // --- Agricultural Information ---
    var agSection = document.createElement('div');
    agSection.className = 'agricultural-info';
    agSection.innerHTML =
      '<h2>' + t('agricultural_info') + '</h2>' +
      '<div class="stats-loading">' + t('loading') + '</div>';
    inner.appendChild(agSection);

    // --- Environmental Information ---
    var envSection = document.createElement('div');
    envSection.className = 'environmental-info';
    envSection.innerHTML =
      '<h2>' + t('environmental_info') + '</h2>' +
      '<div class="stats-loading">' + t('loading') + '</div>';
    inner.appendChild(envSection);

    // --- Water-Balance Section (optional) ---
    var wbSection = document.createElement('div');
    wbSection.className = 'water-balance optional';
    wbSection.innerHTML =
      '<h2>' + t('water_balance') + '</h2>' +
      '<p class="hint small">' + t('water_balance_note') + '</p>' +
      '<div class="status-indicators">' +
        '<div class="status green" title="' + t('status_green') + '"></div>' +
        '<div class="status amber" title="' + t('status_amber') + '"></div>' +
        '<div class="status red" title="' + t('status_red') + '"></div>' +
        '<div class="status nodata" title="' + t('status_nodata') + '"></div>' +
      '</div>' +
      '<p class="hint small">' + t('water_balance_disclaimer') + '</p>';
    inner.appendChild(wbSection);

    // --- CSV Download ---
    var csvSection = document.createElement('div');
    csvSection.className = 'csv-export';
    csvSection.innerHTML =
      '<div class="actions">' +
        '<button class="btn" onclick="Atlas.components.ucPanel.exportCSV()">' + t('download_csv') + '</button>' +
        '<a class="btn ghost" download="" href="" title="' + t('download_geojson') + '">' +
          '<icon name="download" class="icon-sm"></icon> ' + t('download_geojson') +
        '</a>' +
      '</div>';
    inner.appendChild(csvSection);

    // --- Chart Area ---
    var chartSection = document.createElement('div');
    chartSection.className = 'uc-chart';
    chartSection.innerHTML =
      '<h2>' + t('chart_title') + '</h2>' +
      '<div class="chart-placeholder">' +
        '<p class="hint">' + t('no_series_no_data') + '</p>' +
        '<p class="hint small">' + t('data_pending_uc', { uc: ucFeature ? ucFeature.properties.uc_name_en : t('unknown') }) + '</p>' +
      '</div>';
    inner.appendChild(chartSection);

    // --- Status Card ---
    var statusCard = Atlas.components.states.statusCard;
    if (statusCard) {
      var cur = Atlas.data.districtService.currentFor(seriesData, ucFeature.properties);
      inner.appendChild(statusCard(cur, ucFeature.properties));
    }
  }

  /* ---- Navigation ---- */
  function backToProvince() {
    Atlas.components.district.backToProvince();
  }

  function backToDistrict() {
    state.level = 'district';
    state.ucId = null;
    Atlas.components.states.render();
  }

  /* ---- CSV Export ---- */
  function exportCSV() {
    var ucId = state.ucId;
    var fc = Atlas.data.loadUCs(state.districtId);
    var f = fc ? fc.features.filter(function (x) { return x.properties.uc_id === ucId; })[0] : null;
    if (f) {
      var row = [
        f.properties.uc_id || '',
        f.properties.uc_name_en || f.properties.uc_name || '',
        '', '', '', '', '', '', '', // placeholder rows for agricultural/environmental data
        '# method: placeholder',
        '# sources: placeholder',
        '# generated_at: placeholder'
      ];
      csv.download('kp-atlas-uc-' + ucId + '.csv', [row]);
    }
  }

  /* ---- Initialization ---- */
  function init() {
    if (state.level === 'uc' && state.ucId) {
      render();
    }
  }

  return { render: render, init: init, exportCSV: exportCSV, backToProvince: backToProvince, backToDistrict: backToDistrict };
})();