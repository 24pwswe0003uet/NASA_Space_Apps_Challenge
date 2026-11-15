/* Series and measurement adapter. Translates the payloads described in
   docs/data-contract.md (meta.json, feature properties, series/<id>.json) into
   UI-ready shapes so that panels, cards, charts and exports never read raw
   contract fields themselves. Nothing here computes a scientific value: every
   number is passed through as supplied, and missing values stay null.

   If the backend contract changes, this file and js/services/data-service.js
   are the only places that should need to follow it. */
window.Atlas = window.Atlas || {};

Atlas.adapters = (function () {
  'use strict';

  var Layers = window.AtlasLayers;

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // ---- Reporting periods --------------------------------------------------
  // Periods come from the series itself; the product's cadence (dekads today)
  // is whatever the backend supplies, so no count or length is assumed.
  function periods(ser, meta) {
    var src = (ser && Array.isArray(ser.dekads) && ser.dekads.length) ? ser.dekads
            : (meta && Array.isArray(meta.dekads)) ? meta.dekads : [];
    return src.map(function (d) { return { start: d.start, end: d.end }; });
  }

  // ---- Water-balance series -----------------------------------------------
  // Returns null when the unit has no series at all. Otherwise:
  // { periods, points:[{start,end,et_mm,rain_mm,deficit_mm,status}],
  //   total, missing, complete, empty, et_method, status_basis, sources, generated_at }
  // 'missing' counts periods where any of ET/rain/deficit is absent; the caller
  // decides how to word that. Values are never filled in.
  function waterBalance(ser, meta) {
    if (!ser || !Array.isArray(ser.dekads)) return null;
    var points = ser.dekads.map(function (d) {
      return {
        start: d.start, end: d.end,
        et_mm: isNum(d.et_mm) ? d.et_mm : null,
        rain_mm: isNum(d.rain_mm) ? d.rain_mm : null,
        deficit_mm: isNum(d.deficit_mm) ? d.deficit_mm : null,
        status: d.status || 'nodata'
      };
    });
    var missing = points.filter(function (p) {
      return p.et_mm == null || p.rain_mm == null || p.deficit_mm == null;
    }).length;
    return {
      periods: points.map(function (p) { return { start: p.start, end: p.end }; }),
      points: points,
      total: points.length,
      missing: missing,
      complete: points.length > 0 && missing === 0,
      empty: points.length === 0 || missing === points.length,
      et_method: ser.et_method || (meta && meta.et_method) || null,
      status_basis: ser.status_basis || (meta && meta.status_basis) || null,
      sources: ser.sources || {},
      generated_at: ser.generated_at || (meta && meta.generated_at) || null
    };
  }

  // One period's water balance for a unit. Falls back to the polygon's own
  // latest values when there is no series and the latest period is selected,
  // which is what the contract guarantees to be in step.
  function waterBalanceAt(ser, index, props, isLatest) {
    var empty = { status: 'nodata', deficit_mm: null, et_mm: null, rain_mm: null, start: null, end: null };
    if (ser && Array.isArray(ser.dekads) && ser.dekads[index]) {
      var d = ser.dekads[index];
      return { status: d.status || 'nodata',
               deficit_mm: isNum(d.deficit_mm) ? d.deficit_mm : null,
               et_mm: isNum(d.et_mm) ? d.et_mm : null,
               rain_mm: isNum(d.rain_mm) ? d.rain_mm : null,
               start: d.start, end: d.end };
    }
    if (!ser && isLatest && props) {
      return { status: props.status || 'nodata',
               deficit_mm: isNum(props.deficit_mm) ? props.deficit_mm : null,
               et_mm: isNum(props.et_mm) ? props.et_mm : null,
               rain_mm: isNum(props.rain_mm) ? props.rain_mm : null,
               start: null, end: null };
    }
    return empty;
  }

  // ---- Static (non-temporal) measurements ---------------------------------
  // Builds the list of area measurements for a unit from the layer catalog and
  // meta.json sources. availability is one of:
  //   'live'          value present
  //   'not_connected' the backing source is not live (e.g. WorldCereal)
  //   'missing'       source is live but this unit has no value
  function measurements(props, meta) {
    if (!Layers) return [];
    return Layers.continuous().map(function (layer) {
      var v = props ? props[layer.id] : null;
      var src = (meta && meta.sources && layer.source) ? meta.sources[layer.source] : null;
      var connected = !src || src.status === 'live';
      return {
        id: layer.id,
        nameKey: layer.nameKey,
        icon: layer.icon,
        unitKey: layer.unit,
        value: isNum(v) ? v : null,
        availability: isNum(v) ? 'live' : (connected ? 'missing' : 'not_connected'),
        sourceName: src ? src.name : null
      };
    });
  }

  // Identification block for a unit, independent of level.
  function identity(props, level) {
    if (!props) return null;
    return {
      level: level,
      id: level === 'uc' ? props.uc_id : props.district_id,
      districtId: props.district_id,
      name: level === 'uc' ? props.uc_name_en : null
    };
  }

  // Source entries shown under a panel, from meta.json. Order is presentation
  // order; the keys are the ones the contract defines.
  var SOURCE_ORDER = ['cropland', 'crop_type', 'water_demand', 'rain', 'boundaries'];
  function sources(meta) {
    if (!meta || !meta.sources) return [];
    return SOURCE_ORDER.filter(function (k) { return meta.sources[k]; }).map(function (k) {
      var s = meta.sources[k];
      return { key: k, name: s.name, live: s.status === 'live', licence: s.licence || null };
    });
  }

  return {
    periods: periods,
    waterBalance: waterBalance,
    waterBalanceAt: waterBalanceAt,
    measurements: measurements,
    identity: identity,
    sources: sources
  };
})();
