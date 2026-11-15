/* Export service. Builds CSV row matrices for the district and union-council
   views from adapter output, then hands them to js/services/csv.js. Column
   headings carry their units; missing values are written as empty cells, never
   as zero; nothing is computed here. Returns a result object so the UI can
   show failure instead of a false success. */
window.Atlas = window.Atlas || {};

Atlas.exporter = (function () {
  'use strict';

  var csv = Atlas.csv;
  var A = Atlas.adapters;

  function cell(v) { return v == null ? '' : v; }
  function safeName(s) { return String(s || '').replace(/[^A-Za-z0-9._-]+/g, '-'); }

  // Comment rows appended to every export so a file stays self-describing.
  function trailer(meta, extra) {
    var rows = [[]];
    (extra || []).forEach(function (r) { rows.push(r); });
    rows.push(['# level_3_units', (meta && meta.unit_note) || 'see data contract']);
    rows.push(['# generated_at', (meta && meta.generated_at) || '']);
    rows.push(['# note', 'Area-level aggregates. Empty cells mean the value was not available; they are not zeros.']);
    return rows;
  }

  // Time series of one unit (district or UC): one row per reporting period.
  function seriesRows(ser, meta, id, label) {
    var wb = A.waterBalance(ser, meta);
    if (!wb || wb.empty) return null;
    var rows = [['id', 'name', 'period_start', 'period_end', 'water_needed_mm', 'rain_mm', 'deficit_mm', 'status']];
    wb.points.forEach(function (p) {
      rows.push([id, label, p.start, p.end, cell(p.et_mm), cell(p.rain_mm), cell(p.deficit_mm), p.status]);
    });
    var src = Object.keys(wb.sources).map(function (k) { return k + ': ' + wb.sources[k]; }).join(' | ');
    return rows.concat(trailer(meta, [
      ['# water_needed_method', wb.et_method || ''],
      ['# status_basis', wb.status_basis || ''],
      ['# sources', src]
    ]));
  }

  // One row per union council of a district for the selected period, with the
  // static area measurements alongside. statusById may carry the period's
  // statuses when a non-latest period is selected.
  function districtTableRows(fc, meta, districtProps, period, statusById, seriesById) {
    if (!fc || !fc.features || !fc.features.length) return null;
    var measures = A.measurements(fc.features[0].properties, meta);
    var head = ['uc_id', 'uc_name', 'district_id', 'district_name', 'period_start', 'period_end'];
    measures.forEach(function (m) { head.push(m.id); });          // *_ha columns carry the unit in their name
    head = head.concat(['water_needed_mm', 'rain_mm', 'deficit_mm', 'status']);
    var rows = [head];
    fc.features.forEach(function (f) {
      var p = f.properties;
      var ser = seriesById ? seriesById[p.uc_id] : null;
      var idx = period ? period.index : null;
      var wb = (ser && idx != null) ? A.waterBalanceAt(ser, idx, p, period.isLatest)
                                     : A.waterBalanceAt(null, 0, p, true);
      var st = statusById && statusById[p.uc_id] ? statusById[p.uc_id] : wb.status;
      var row = [p.uc_id, p.uc_name_en, p.district_id, districtProps ? districtProps.name_en : '',
                 period ? period.start : '', period ? period.end : ''];
      A.measurements(p, meta).forEach(function (m) { row.push(cell(m.value)); });
      row.push(cell(wb.et_mm), cell(wb.rain_mm), cell(wb.deficit_mm), st);
      rows.push(row);
    });
    return rows.concat(trailer(meta));
  }

  // Trigger a download; never throws. Returns {ok, reason}.
  function download(filename, rows) {
    if (!rows || rows.length < 2) return { ok: false, reason: 'empty' };
    try {
      csv.download(filename, rows);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'failed', error: e };
    }
  }

  function seriesFilename(id) { return 'kp-atlas-' + safeName(id) + '-series.csv'; }
  function tableFilename(districtId, period) {
    return 'kp-atlas-' + safeName(districtId) + '-union-councils' + (period ? '-' + period.start : '') + '.csv';
  }

  return {
    seriesRows: seriesRows,
    districtTableRows: districtTableRows,
    download: download,
    seriesFilename: seriesFilename,
    tableFilename: tableFilename
  };
})();
