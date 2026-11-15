/* Statistic components: the measurement grid, the compact measurement list and
   the identification block. One visual system for every measured number, so a
   new dataset needs a catalog entry, not new markup. Values arrive formatted by
   the caller or as {value, unit}; a missing value renders as an explicit
   unavailable state (never 0), with the reason when it is known. */
window.Atlas = window.Atlas || {};
Atlas.components = Atlas.components || {};

Atlas.components.stats = (function () {
  'use strict';

  var util = Atlas.util, el = util.el;
  function t(k, v) { return Atlas.i18n.t(k, v); }
  function icon(n, c) { return window.atlasIcon(n, c); }

  // How an unavailable value is worded, by availability code.
  function unavailableText(code) {
    if (code === 'not_connected') return t('not_connected');
    return t('not_available');
  }

  // item: { icon, label, value (formatted string|null), unit, availability,
  //         note, tooltip }
  function card(item) {
    var has = item.value != null;
    var node = el('div', { 'class': 'stat' + (has ? '' : ' empty'),
      title: item.tooltip || null }, [
      el('div', { 'class': 'k' }, [item.icon ? icon(item.icon, 'icon-sm') : null, document.createTextNode(item.label)]),
      has
        ? el('div', { 'class': 'v num' }, [document.createTextNode(item.value),
            item.unit ? el('small', { text: ' ' + item.unit }) : null])
        : el('div', { 'class': 'v', text: unavailableText(item.availability) })
    ]);
    if (item.note) node.appendChild(el('div', { 'class': 'stat-note', text: item.note }));
    return node;
  }

  function grid(items) {
    var g = el('div', { 'class': 'stats' });
    items.forEach(function (it) { g.appendChild(card(it)); });
    return g;
  }

  // Compact two-column rows for secondary measurements (identification,
  // environmental values); avoids a wall of large cards on a phone.
  function rows(items) {
    var list = el('dl', { 'class': 'measures' });
    items.forEach(function (it) {
      var has = it.value != null;
      list.appendChild(el('div', { 'class': 'measure' + (has ? '' : ' empty') }, [
        el('dt', {}, [it.icon ? icon(it.icon, 'icon-sm') : null, document.createTextNode(it.label)]),
        el('dd', { 'class': has ? 'num' : '' }, [
          document.createTextNode(has ? it.value : unavailableText(it.availability)),
          has && it.unit ? el('small', { text: ' ' + it.unit }) : null
        ])
      ]));
    });
    return list;
  }

  // A short labelled line of metadata (source, period, level) under a block.
  function metaLine(parts) {
    var p = el('p', { 'class': 'meta-line' });
    parts.filter(Boolean).forEach(function (s, i) {
      if (i) p.appendChild(el('span', { 'class': 'sep', text: ' · ' }));
      p.appendChild(document.createTextNode(s));
    });
    return p;
  }

  // Measurement adapter output -> card items (formatting lives here, not in
  // the panel code).
  function fromMeasurements(list) {
    return list.map(function (m) {
      return {
        icon: m.icon, label: t(m.nameKey),
        value: m.value == null ? null : util.fmtInt(m.value),
        unit: t(m.unitKey), availability: m.availability,
        tooltip: m.sourceName || null
      };
    });
  }

  return { card: card, grid: grid, rows: rows, metaLine: metaLine, fromMeasurements: fromMeasurements };
})();
