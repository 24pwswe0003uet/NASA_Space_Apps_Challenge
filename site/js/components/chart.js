/* Chart component. One renderer for every time-series chart in the Atlas.
   It receives a prepared spec from the controller (x labels, named series,
   unit, metadata) and owns: lazy loading of Plotly, the loading, empty,
   partial-data and error states, the table fallback when Plotly is
   unavailable, and cleanup of previous plots. It never fetches data and never
   derives a value; every number is drawn exactly as given (null = gap).

   spec = {
     x: ['11 Sept', ...],                  // period labels, in order
     series: [{ key, name, values[], kind: 'bar'|'line', color, hover }],
     unit: 'mm',                           // y-axis unit label (already localised)
     height: 236,                          // optional
     barmode: 'group'|'stack',             // optional
     yTitle: true|false,                   // show unit on the y axis
     missing: 0, total: 6, partialText,    // optional partial-data counts / wording
     meta: { period, level, source, generated }  // optional footer parts
     tableHead: ['Ten days', ...], tableRows: [[...], ...]   // fallback table
   } */
window.Atlas = window.Atlas || {};
Atlas.components = Atlas.components || {};

Atlas.components.chart = (function () {
  'use strict';

  var util = Atlas.util, el = util.el, cfg = Atlas.config;
  function t(k, v) { return Atlas.i18n.t(k, v); }
  function icon(n, c) { return window.atlasIcon(n, c); }

  var plotlyPromise = null;
  function loadPlotly() {
    if (window.Plotly) return Promise.resolve();
    if (!plotlyPromise) plotlyPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = cfg.plotlyUrl;
      s.onload = resolve;
      s.onerror = function () { plotlyPromise = null; reject(new Error('plotly')); };
      document.head.appendChild(s);
    });
    return plotlyPromise;
  }

  // Remove a previous plot from a node before drawing again or replacing it.
  function purge(node) {
    if (node && window.Plotly && node.classList && node.classList.contains('js-plotly-plot')) {
      try { window.Plotly.purge(node); } catch (e) {}
    }
  }

  function footer(meta) {
    if (!meta) return null;
    var parts = [];
    if (meta.period) parts.push(t('meta_period', { period: meta.period }));
    if (meta.level) parts.push(meta.level);
    if (meta.source) parts.push(t('meta_source', { source: meta.source }));
    if (meta.generated) parts.push(t('generated', { ts: meta.generated }));
    if (!parts.length) return null;
    return Atlas.components.stats.metaLine(parts);
  }

  function stateNode(kind, text) {
    return el('div', { 'class': 'chart-state ' + kind, role: 'status' }, [
      kind === 'loading' ? el('span', { 'class': 'spinner' }) : icon(kind === 'error' ? 'alert' : 'info', 'icon-sm'),
      el('span', { text: text })]);
  }

  function fallbackTable(spec) {
    if (!spec.tableHead || !spec.tableRows) return null;
    var tbl = el('table', { 'class': 'chart-table' });
    tbl.appendChild(el('tr', {}, spec.tableHead.map(function (h) { return el('th', { text: h }); })));
    spec.tableRows.forEach(function (r) {
      tbl.appendChild(el('tr', {}, r.map(function (c, i) {
        return el('td', { 'class': i ? 'num' : '', text: c == null ? '—' : c });
      })));
    });
    return tbl;
  }

  function traces(spec) {
    return spec.series.map(function (s) {
      var base = { name: s.name, x: spec.x, y: s.values, connectgaps: false,
                   hovertemplate: (s.hover || '%{y:.1f} ' + spec.unit) + '<extra>' + s.name + '</extra>' };
      if (s.kind === 'line') {
        return Object.assign(base, { type: 'scatter', mode: 'lines+markers',
          line: { color: s.color, width: 2 }, marker: { size: 6, color: s.color } });
      }
      return Object.assign(base, { type: 'bar', marker: { color: s.color } });
    });
  }

  function layout(spec) {
    var h = spec.height || 236;
    return {
      barmode: spec.barmode || 'group', height: h,
      margin: { l: spec.yTitle === false ? 30 : 38, r: 10, t: 6, b: 30 },
      legend: { orientation: 'h', y: 1.18, x: 0, font: { size: 11 } },
      yaxis: { title: spec.yTitle === false ? undefined : { text: spec.unit, font: { size: 11 } },
               gridcolor: cfg.chart.grid, zerolinecolor: cfg.chart.zero, fixedrange: true },
      xaxis: { tickfont: { size: 10 }, fixedrange: true },
      hovermode: 'x unified',
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: cfg.chart.font, color: cfg.chart.ink }
    };
  }

  // Draws spec into a fresh wrapper that replaces `node`. Returns the wrapper.
  function render(node, spec) {
    var wrap = el('div', { 'class': 'chart-block' });
    node.replaceWith(wrap);

    // empty: nothing to draw at all
    var anyValue = spec && spec.series && spec.series.some(function (s) {
      return s.values.some(function (v) { return v != null; });
    });
    if (!spec || !spec.x || !spec.x.length || !anyValue) {
      wrap.appendChild(stateNode('empty', t('no_series')));
      return wrap;
    }

    var plot = el('div', { 'class': 'chart', style: 'height:' + (spec.height || 236) + 'px' });
    var loading = stateNode('loading', t('chart_loading'));
    wrap.appendChild(loading);
    wrap.appendChild(plot);

    if (spec.missing) {
      wrap.appendChild(el('p', { 'class': 'chart-partial' }, [icon('info', 'icon-sm'),
        el('span', { text: spec.partialText || t('partial_periods', { n: spec.missing, total: spec.total }) })]));
    }
    var foot = footer(spec.meta);
    if (foot) wrap.appendChild(foot);

    loadPlotly().then(function () {
      purge(plot);
      return window.Plotly.newPlot(plot, traces(spec), layout(spec), { displayModeBar: false, responsive: true });
    }).then(function () {
      loading.remove();
    }).catch(function () {
      // Plotly unavailable (offline, blocked CDN): show the numbers as a table.
      loading.remove();
      var tbl = fallbackTable(spec);
      plot.replaceWith(tbl || stateNode('error', t('chart_error')));
      if (tbl) wrap.insertBefore(stateNode('error', t('chart_error')), tbl);
    });
    return wrap;
  }

  return { render: render, purge: purge, loadPlotly: loadPlotly };
})();
