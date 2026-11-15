/* KP Open Farm Atlas. Static site that reads /data (see docs/data-contract.md).
   Three views: province, district, union council. No framework, no build step.
   This controller wires the shared modules (config, utils, services, components)
   to the Leaflet map and the details panel; it owns no URLs or data shapes. */
(function () {
  'use strict';

  // Shared modules own the URLs, helpers, state and data access.
  var cfg = window.Atlas.config, util = window.Atlas.util, data = window.Atlas.data;
  var i18n = window.Atlas.i18n, state = window.Atlas.state;
  var motion = window.Atlas.motion;
  // Adapter turns contract payloads into UI shapes; exporter builds CSV matrices.
  var A = window.Atlas.adapters, exporter = window.Atlas.exporter;
  var states = window.Atlas.components.states, legend = window.Atlas.components.legend;
  var Stats = window.Atlas.components.stats, Chart = window.Atlas.components.chart;
  // Layer catalog + helpers live in js/layers and js/services; the map reads them
  // instead of hardcoding which layers exist.
  var Layers = window.AtlasLayers, LayerControl = window.AtlasLayerControl, Temporal = window.AtlasTemporal;

  var COLORS = cfg.colors;
  var qs = util.qs, el = util.el;
  var fmtInt = util.fmtInt, fmtMm = util.fmtMm, fmtDate = util.fmtDate;
  var dekadLabel = util.dekadLabel, stamp = util.stamp;
  var quantiles = util.quantiles, haColor = util.haColor;
  function t(key, vars) { return i18n.t(key, vars); }
  function nameOf(p) { return i18n.name(p); }

  var meta = null, districts = null;
  var map, districtLayer = null, ucLayer = null, ucLayerKey = null, firstFit = true;
  var baseLayers = {}, labelOverlay = null, activeBase = localStorage.getItem('atlas.base') || 'light';
  var showLabels = localStorage.getItem('atlas.labels') !== 'off';
  var provinceStatuses = null;

  // ------------------------------------------------------------------ helpers
  function icon(name, cls) { return window.atlasIcon(name, cls); }
  function setLoading(on) { states.setLoading(on); }
  function showPanel(on) {
    document.body.classList.toggle('show-map', !on);
    qs('mapToggleLabel').textContent = on ? t('show_map') : t('show_details');
    if (!on && map) setTimeout(function () { map.invalidateSize(); }, 60);
  }
  function renderLegend(breaks) { legend.render({ breaks: breaks }); }

  // Data access is delegated to the shared data service
  // (js/services/data-service.js), which owns the data/ URLs, caching and the
  // offline snapshot. The controller only asks for domain objects.
  function DATA() { return data.DATA(); }
  function getJSON(path, bust) { return data.getJSON(path, bust); }
  function series(id) { return data.series(id); }
  function loadUCs(did) { return data.loadUCs(did); }
  function loadAllUCs() { return data.loadAllUCs(); }

  // Province view: districts until the reader zooms in, then every union council.
  var DETAIL_ZOOM = cfg.detailZoom;
  function syncDetail() {
    if (state.level !== 'province') return;
    var want = map.getZoom() >= DETAIL_ZOOM;
    if (want === state.detail) return;
    state.detail = want;
    if (!want) {
      if (ucLayer) { map.removeLayer(ucLayer); ucLayer = null; }
      renderLegend(drawDistricts(provinceStatuses));
      return;
    }
    setLoading(true);
    loadAllUCs().then(function (fc) {
      if (state.level !== 'province' || !state.detail) { setLoading(false); return; }
      return statusesFor(fc.features, 'uc_id').then(function (st) {
        drawDistricts(provinceStatuses);
        renderLegend(drawUCs(fc, st));
        setLoading(false);
      });
    });
  }

  function dekadAt(ser, i) { return A.waterBalanceAt(ser, i, null, false); }
  function isLatest() { return state.dekadIndex === meta.dekads.length - 1; }
  function currentPeriod() {
    var d = meta.dekads[state.dekadIndex];
    return { index: state.dekadIndex, start: d.start, end: d.end, isLatest: isLatest() };
  }
  function levelLabel(level) { return t(level === 'uc' ? 'level_uc' : 'level_district'); }
  // The key that decides whether the union-council layer must be redrawn:
  // same district, period and map layer means only the selection changes.
  function ucKey(did) { return did + '|' + state.dekadIndex + '|' + state.layer + '|' + activeBase + '|' + showLabels; }
  function hasCropType() { return meta.sources.crop_type && meta.sources.crop_type.status === 'live'; }
  function demandLabel() { return meta.et_method === 'wapor_aeti' ? t('demand_actual') : t('demand_ref'); }
  function currentLayer() { return Layers.resolve(state.layer); }
  function isStatusLayer() { return currentLayer().id === 'status'; }
  function layerUnit(l) { return t((l || currentLayer()).unit); }
  // keep the header period control in step with whether the active layer is time-based
  function syncTemporal() { if (Temporal) Temporal.apply(Layers.isTemporal(currentLayer().id), t); }

  // ------------------------------------------------------------------ map
  var BASES_TILE = cfg.tileBases;
  var LABEL_TILE = cfg.labelTile;

  function setBase(key) {
    activeBase = BASES_TILE[key] ? key : 'light';
    localStorage.setItem(cfg.baseStorageKey, activeBase);
    Object.keys(baseLayers).forEach(function (k) {
      if (map.hasLayer(baseLayers[k])) map.removeLayer(baseLayers[k]);
    });
    if (!baseLayers[activeBase]) {
      var cfgBase = BASES_TILE[activeBase];
      baseLayers[activeBase] = L.tileLayer(cfgBase.url, { attribution: cfgBase.attr, maxZoom: cfgBase.max });
    }
    baseLayers[activeBase].addTo(map).bringToBack();
    if (labelOverlay) map.removeLayer(labelOverlay);
    if (BASES_TILE[activeBase].labels) {
      labelOverlay = L.tileLayer(LABEL_TILE, { maxZoom: 16, opacity: activeBase === 'imagery' ? 0.9 : 1,
        pane: 'shadowPane', attribution: '' });
      labelOverlay.addTo(map);
    }
    document.body.classList.toggle('dark-base', activeBase === 'imagery');
    var box = qs('baseSwitch');
    if (box) Array.prototype.forEach.call(box.children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-base') === activeBase);
    });
    restyle();
  }

  function buildMapControls() {
    var box = qs('baseSwitch');
    box.innerHTML = '';
    [['light', 'map'], ['imagery', 'satellite'], ['terrain', 'layers']].forEach(function (b) {
      box.appendChild(el('button', { type: 'button', 'data-base': b[0], title: t('base_' + b[0]),
        'aria-label': t('base_' + b[0]), onclick: function () { setBase(b[0]); } }, [icon(b[1], 'icon-sm')]));
    });
    Array.prototype.forEach.call(box.children, function (b) {
      b.classList.toggle('on', b.getAttribute('data-base') === activeBase);
    });
    var lab = qs('labelToggle');
    lab.setAttribute('title', t('toggle_labels'));
    lab.setAttribute('aria-label', t('toggle_labels'));
    lab.classList.toggle('on', showLabels);
    lab.addEventListener('click', function () {
      showLabels = !showLabels;
      localStorage.setItem(cfg.labelsStorageKey, showLabels ? 'on' : 'off');
      lab.classList.toggle('on', showLabels);
      rerender(true);
    });
  }

  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 5 }).setView([34.2, 71.8], 7);
    L.control.zoom({ position: 'topleft' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
    map.on('zoomend moveend', updateLabels);
    map.on('zoomend', syncDetail);
    setBase(activeBase);
    qs('mapToggle').addEventListener('click', function () {
      showPanel(document.body.classList.contains('show-map'));
    });
  }
  function detailHint() {
    if (state.level !== 'province') return null;
    return el('p', { 'class': 'hint' }, [
      el('span', { text: state.detail ? t('detail_on') : t('detail_off') })]);
  }
  function restyle() {
    if (!districtLayer) return;
    if (isStatusLayer()) {
      districtLayer.setStyle(function (f) {
        return styleFor(f.properties._st || f.properties.status, state.level !== 'province');
      });
      return;
    }
    var layer = currentLayer();
    var breaks = quantiles(districts.features.map(function (f) { return f.properties[layer.id]; }));
    var dim = state.level !== 'province' || state.detail;
    districtLayer.setStyle(function (f) { return rampStyle(haColor(f.properties[layer.id], breaks), dim); });
  }
  function fit(bounds, pad) {
    map.invalidateSize();
    map.fitBounds(bounds, { padding: [pad, pad], animate: !firstFit, duration: 0.5 });
    firstFit = false;
  }
  function styleFor(status, dim) {
    var dark = activeBase === 'imagery';
    return { color: dark ? '#0f141b' : '#ffffff', weight: dim ? 0.7 : 1.1, opacity: dim ? 0.6 : 1,
             fillColor: COLORS[status] || COLORS.nodata, fillOpacity: dim ? 0.2 : (dark ? 0.62 : 0.8) };
  }
  function rampStyle(fillColor, dim) {
    var dark = activeBase === 'imagery';
    return { color: dark ? '#0f141b' : '#ffffff', weight: dim ? 0.7 : 1.1, opacity: dim ? 0.6 : 1,
             fillColor: fillColor, fillOpacity: dim ? 0.2 : (dark ? 0.62 : 0.85) };
  }
  function hoverable(layer, baseStyle) {
    layer.on('mouseover', function () {
      layer.setStyle({ weight: 2.6, color: '#0f141b', fillOpacity: 0.9 });
      if (layer.bringToFront) layer.bringToFront();
    });
    layer.on('mouseout', function () { layer.setStyle(baseStyle()); });
  }
  var labelled = [];
  function addLabel(layer, html) {
    if (!showLabels) {
      layer.bindTooltip(html, { sticky: true, className: 'map-label hover-only', opacity: 1 });
      return;
    }
    layer._atlasLabel = html;
    labelled.push(layer);
  }
  // Leaflet has no label collision handling, so only label polygons that are
  // large enough on screen to hold the text. Re-evaluated on every zoom and pan.
  function updateLabels() {
    if (!showLabels) return;
    var minW = 64, minH = 30;
    labelled.forEach(function (layer) {
      if (!layer._atlasLabel || !map.hasLayer(layer)) return;
      var b = layer.getBounds();
      var nw = map.latLngToContainerPoint(b.getNorthWest());
      var se = map.latLngToContainerPoint(b.getSouthEast());
      var big = (se.x - nw.x) >= minW && (se.y - nw.y) >= minH;
      var onScreen = map.getBounds().intersects(b);
      if (big && onScreen) {
        if (!layer.getTooltip()) {
          layer.bindTooltip(layer._atlasLabel, { permanent: true, direction: 'center',
            className: 'map-label', opacity: 1, interactive: false });
        }
      } else if (layer.getTooltip()) {
        layer.unbindTooltip();
      }
    });
  }
  function resetLabels() { labelled = []; }
  function tooltip(title, sub) {
    return '<b>' + title + '</b><br><span class="tt-sub">' + sub + '</span>';
  }

  function drawDistricts(statusById) {
    if (districtLayer) map.removeLayer(districtLayer);
    resetLabels();
    var layer = currentLayer();
    var status = layer.id === 'status';
    var dim = state.level !== 'province' || state.detail;
    var breaks = status ? null
      : quantiles(districts.features.map(function (f) { return f.properties[layer.id]; }));
    function fill(p) { return status ? styleFor(p._st, dim) : rampStyle(haColor(p[layer.id], breaks), dim); }
    districtLayer = L.geoJSON(districts, {
      style: function (f) { var p = f.properties; p._st = statusById ? statusById[p.district_id] : p.status; return fill(p); },
      onEachFeature: function (f, layer2) {
        var p = f.properties;
        p._st = statusById ? statusById[p.district_id] : p.status;
        if (!dim) {
          var val = status
            ? (isLatest() && p.deficit_mm != null ? Math.round(p.deficit_mm) + ' ' + t('mm') : '')
            : (p[layer.id] == null ? '' : fmtInt(p[layer.id]) + ' ' + layerUnit(layer));
          addLabel(layer2, '<span class="ml-n">' + nameOf(p) + '</span>' +
            (val ? '<span class="ml-v">' + val + '</span>' : ''));
          hoverable(layer2, function () { return status ? styleFor(p._st, false) : rampStyle(haColor(p[layer.id], breaks), false); });
        }
        layer2.on('click', function () { openDistrict(p.district_id); });
      }
    }).addTo(map);
    if (dim && ucLayer) ucLayer.bringToFront();
    updateLabels();
    return breaks;
  }

  var SELECTED_STYLE = { color: '#0f141b', weight: 2.8, fillOpacity: 0.92 };
  function drawUCs(fc, statusById, did) {
    if (ucLayer) map.removeLayer(ucLayer);
    var layer = currentLayer();
    var status = layer.id === 'status';
    var breaks = status ? null
      : quantiles(fc.features.map(function (f) { return f.properties[layer.id]; }));
    ucLayer = L.geoJSON(fc, {
      style: function (f) {
        var p = f.properties;
        if (status) return styleFor(statusById ? statusById[p.uc_id] : p.status, false);
        return rampStyle(haColor(p[layer.id], breaks), false);
      },
      onEachFeature: function (f, lyr) {
        var p = f.properties;
        var st = statusById ? statusById[p.uc_id] : p.status;
        var val = status
          ? (isLatest() && p.deficit_mm != null ? Math.round(p.deficit_mm) + ' ' + t('mm') : '')
          : (p[layer.id] == null ? '' : fmtInt(p[layer.id]) + ' ' + layerUnit(layer));
        addLabel(lyr, '<span class="ml-n">' + p.uc_name_en + '</span>' +
          (val ? '<span class="ml-v">' + val + '</span>' : ''));
        var base = function () {
          return status ? styleFor(st, false) : rampStyle(haColor(p[layer.id], breaks), false);
        };
        lyr._atlasBase = base;
        hoverable(lyr, function () { return state.ucId === p.uc_id ? SELECTED_STYLE : base(); });
        lyr.on('click', function () { openUC(p.district_id, p.uc_id); });
        if (state.ucId === p.uc_id) lyr.setStyle(SELECTED_STYLE);
      }
    }).addTo(map);
    ucLayer._atlasBreaks = breaks;
    ucLayerKey = did ? ucKey(did) : null;
    ucLayer.bringToFront();
    updateLabels();
    return breaks;
  }
  // Redraw the union councils only when district, period or layer changed;
  // otherwise just move the selection highlight. Returns the ramp breaks.
  function ensureUCs(did, fc, statusById) {
    if (ucLayer && ucLayerKey === ucKey(did)) {
      ucLayer.eachLayer(function (lyr) {
        var p = lyr.feature.properties;
        if (!lyr._atlasBase) return;
        lyr.setStyle(state.ucId === p.uc_id ? SELECTED_STYLE : lyr._atlasBase());
        if (state.ucId === p.uc_id && lyr.bringToFront) lyr.bringToFront();
      });
      return ucLayer._atlasBreaks;
    }
    return drawUCs(fc, statusById, did);
  }

  function statusesFor(features, idKey) {
    if (isLatest()) return Promise.resolve(null);
    return Promise.all(features.map(function (f) { return series(f.properties[idKey]); })).then(function (all) {
      var out = {};
      all.forEach(function (s, i) { out[features[i].properties[idKey]] = dekadAt(s, state.dekadIndex).status; });
      return out;
    });
  }

  // ------------------------------------------------------------------ province
  function openProvince(keepView) {
    state.level = 'province'; state.districtId = null; state.ucId = null;
    if (!Layers.isAvailable(currentLayer(), meta, districts.features)) state.layer = Layers.defaultId;
    if (ucLayer) { map.removeLayer(ucLayer); ucLayer = null; }
    setLoading(true);
    statusesFor(districts.features, 'district_id').then(function (st) {
      provinceStatuses = st;
      state.detail = map.getZoom() >= DETAIL_ZOOM;
      var breaks = drawDistricts(st);
      if (!keepView && !state.playing) fit(districtLayer.getBounds(), 12);
      renderLegend(breaks);
      renderProvince(st);
      showPanel(window.innerWidth > 820);
      setLoading(false);
      syncDetail();
    });
    history.replaceState(null, '', '#');
  }

  // switch the active map layer from anywhere; keeps the current view and level
  function setLayer(id) {
    if (!Layers.get(id) || id === state.layer) return;
    state.layer = id;
    if (state.level === 'province') openProvince(true);
    else if (state.level === 'district') openDistrict(state.districtId, true);
    else if (state.level === 'uc') openUC(state.districtId, state.ucId);
  }

  function valueOf(p) {
    var layer = currentLayer();
    if (layer.id === 'status') return isLatest() ? p.deficit_mm : null;
    return p[layer.id];
  }
  function valueText(p) {
    var layer = currentLayer();
    if (layer.id === 'status') return isLatest() && p.deficit_mm != null ? fmtMm(p.deficit_mm) + ' ' + t('mm') : '';
    return p[layer.id] == null ? t('not_connected') : fmtInt(p[layer.id]) + ' ' + layerUnit(layer);
  }
  function renderProvince(statusById) {
    var layer = currentLayer();
    var status = layer.id === 'status';
    var breaks = status ? null : quantiles(districts.features.map(function (f) { return f.properties[layer.id]; }));
    var inner = panelShell();
    inner.appendChild(el('div', { 'class': 'crumbs' }, [el('span', { 'class': 'here', text: t('province') })]));
    inner.appendChild(el('div', { 'class': 'title-row' }, [el('h1', { text: t('province') })]));
    inner.appendChild(el('p', { 'class': 'sub', text: t('province_sub', { dekad: dekadLabel(meta.dekads[state.dekadIndex]) }) }));
    inner.appendChild(contextLine(null));

    var counts = { green: 0, amber: 0, red: 0, nodata: 0 };
    districts.features.forEach(function (f) {
      var st = statusById ? statusById[f.properties.district_id] : f.properties.status;
      counts[st in counts ? st : 'nodata']++;
    });
    inner.appendChild(el('h2', {}, [icon('droplet'), document.createTextNode(t('summary_title'))]));
    var grid = el('div', { 'class': 'stats' });
    ['red', 'amber', 'green', 'nodata'].forEach(function (s) {
      grid.appendChild(el('div', { 'class': 'stat' }, [
        el('div', { 'class': 'k' }, [el('span', { 'class': 'sw', style: 'background:' + COLORS[s] }),
          document.createTextNode(t('status_' + s))]),
        el('div', { 'class': 'v num', text: counts[s] })]));
    });
    inner.appendChild(grid);

    inner.appendChild(el('h2', {}, [icon('layers'), document.createTextNode(t('layers'))]));
    inner.appendChild(LayerControl.render({
      currentId: layer.id, meta: meta, features: districts.features, t: t, onSelect: setLayer
    }));

    inner.appendChild(el('h2', {}, [icon('chart'), document.createTextNode(t('trend_title'))]));
    var trend = el('div', { 'class': 'chart', style: 'height:180px' });
    inner.appendChild(trend);
    provinceTrend(trend);

    inner.appendChild(el('h2', {}, [icon('map'), document.createTextNode(t('districts_title', { n: districts.features.length }))]));
    inner.appendChild(searchBox());
    var rows = districts.features.slice().sort(function (a, b) {
      var av = valueOf(a.properties), bv = valueOf(b.properties);
      return (bv == null ? -1e9 : bv) - (av == null ? -1e9 : av);
    }).filter(matchQuery(function (p) { return nameOf(p) + ' ' + p.name_en; }));
    var list = el('ul', { 'class': 'list' });
    rows.forEach(function (f) {
      var p = f.properties, st = statusById ? statusById[p.district_id] : p.status;
      var dot = status ? COLORS[st] : haColor(p[layer.id], breaks);
      var row = listRow(dot, nameOf(p), valueText(p), function () { openDistrict(p.district_id); });
      list.appendChild(row);
      if (status) movement(p.district_id, row);
    });
    if (!rows.length) list.appendChild(el('li', { 'class': 'hint', text: t('no_match') }));
    inner.appendChild(list);
    inner.appendChild(el('p', { 'class': 'hint', text: t('tap_district') }));
    var hint = detailHint();
    if (hint) inner.appendChild(hint);
    inner.appendChild(sourcesBlock());
  }

  // Counts of districts per status for every period. Counting classes the
  // pipeline already assigned is presentation, not a scientific calculation.
  function provinceTrend(node) {
    var loading = el('div', { 'class': 'chart-state loading', role: 'status' }, [
      el('span', { 'class': 'spinner' }), el('span', { text: t('chart_loading') })]);
    node.appendChild(loading);
    Promise.all(districts.features.map(function (f) { return series(f.properties.district_id); }))
      .then(function (all) {
        var counts = meta.dekads.map(function () { return { green: 0, amber: 0, red: 0, nodata: 0 }; });
        var got = 0;
        all.forEach(function (ser) {
          var wb = A.waterBalance(ser, meta);
          if (!wb) return;
          got++;
          wb.points.forEach(function (d, i) { if (counts[i]) counts[i][d.status in counts[i] ? d.status : 'nodata']++; });
        });
        if (!got) { Chart.render(node, null); return; }
        var x = meta.dekads.map(function (d) { return fmtDate(d.start); });
        var bar = function (key) {
          return { key: key, name: t('status_' + key), kind: 'bar', color: COLORS[key],
                   values: counts.map(function (c) { return c[key]; }),
                   hover: '%{y} ' + t('districts_word') };
        };
        Chart.render(node, {
          x: x, series: [bar('red'), bar('amber'), bar('green'), bar('nodata')],
          unit: t('districts_word'), barmode: 'stack', height: 180, yTitle: false,
          missing: districts.features.length - got, total: districts.features.length,
          partialText: t('partial_units', { n: districts.features.length - got, total: districts.features.length }),
          meta: { period: dekadLabel(meta.dekads[0]).split(' – ')[0] + ' – ' + fmtDate(meta.dekads[meta.dekads.length - 1].end),
                  level: t('level_province') },
          tableHead: [t('dekad'), t('status_red'), t('status_amber'), t('status_green'), t('status_nodata')],
          tableRows: counts.map(function (c, i) { return [dekadLabel(meta.dekads[i]), c.red, c.amber, c.green, c.nodata]; })
        });
      });
  }

  // ------------------------------------------------------------------ district
  // opts: { keepView: keep the camera and search text, showPanel: force the
  //         panel open (used when stepping back from a union council on a phone) }
  function openDistrict(did, opts) {
    opts = typeof opts === 'boolean' ? { keepView: opts } : (opts || {});
    var keepView = !!opts.keepView;
    var dFeature = districts.features.filter(function (f) { return f.properties.district_id === did; })[0];
    if (!dFeature) { openProvince(); return; }
    state.level = 'district'; state.districtId = did; state.ucId = null;
    if (!keepView) state.query = '';
    setLoading(true);
    Promise.all([loadUCs(did), series(did)]).then(function (res) {
      var fc = res[0], dser = res[1];
      return statusesFor(fc.features, 'uc_id').then(function (st) {
        drawDistricts(null);
        var breaks = ensureUCs(did, fc, st);
        if (!keepView && !state.playing && ucLayer.getLayers().length) fit(ucLayer.getBounds(), 24);
        else if (!ucLayer.getLayers().length && !keepView) fit(L.geoJSON(dFeature).getBounds(), 24);
        renderLegend(breaks);
        renderDistrict(dFeature, fc, dser, st);
        if (!keepView || opts.showPanel) showPanel(true);
        setLoading(false);
      });
    }).catch(function (err) {
      setLoading(false);
      panelError(err);
    });
    history.replaceState(null, '', '#' + did);
  }

  // One line under a title: active layer, selected period, data timestamp.
  function contextLine(ser) {
    return Stats.metaLine([
      t(currentLayer().nameKey),
      Layers.isTemporal(currentLayer().id) ? dekadLabel(meta.dekads[state.dekadIndex]) : null,
      t('generated', { ts: stamp((ser && ser.generated_at) || meta.generated_at) })
    ]);
  }

  // Shown inside the panel when a view cannot be built; the map stays usable.
  function panelError(err) {
    var inner = panelShell();
    inner.appendChild(el('div', { 'class': 'crumbs' }, [
      el('button', { onclick: function () { openProvince(); } }, [icon('chevron-left', 'icon-sm'), document.createTextNode(t('province'))])]));
    inner.appendChild(el('div', { 'class': 'chart-state error', role: 'alert' }, [icon('alert', 'icon-sm'),
      el('span', { text: t('view_error') })]));
    if (err && err.message) inner.appendChild(el('p', { 'class': 'hint', text: String(err.message) }));
  }

  function noBoundariesNotice() {
    return el('div', { 'class': 'notice' }, [icon('info', 'icon-sm'),
      el('span', { text: t('no_uc_boundaries') })]);
  }

  function renderDistrict(dFeature, fc, dser, statusById) {
    var p = dFeature.properties, inner = panelShell();
    inner.appendChild(el('div', { 'class': 'crumbs' }, [
      el('button', { onclick: function () { openProvince(); } }, [icon('chevron-left', 'icon-sm'), document.createTextNode(t('province'))]),
      el('span', { 'class': 'here', 'aria-current': 'page', text: nameOf(p) })]));
    inner.appendChild(el('div', { 'class': 'title-row' }, [el('h1', { text: nameOf(p) })]));
    inner.appendChild(el('p', { 'class': 'sub', text: fc.features.length
      ? t('district_sub', { n: fc.features.length }) : t('district_sub_none') }));
    inner.appendChild(contextLine(dser));

    inner.appendChild(el('h2', {}, [icon('droplet'), document.createTextNode(t('water_title'))]));
    inner.appendChild(statusCard(currentFor(dser, p), p));
    inner.appendChild(el('h2', {}, [icon('sprout'), document.createTextNode(t('land_title'))]));
    inner.appendChild(hectares(p));
    if (!hasCropType()) inner.appendChild(cropTypeNotice());

    inner.appendChild(el('h2', {}, [icon('layers'), document.createTextNode(t('layers'))]));
    inner.appendChild(LayerControl.render({
      currentId: currentLayer().id, meta: meta, features: fc.features, t: t, onSelect: setLayer
    }));

    inner.appendChild(el('h2', {}, [icon('chart'), document.createTextNode(t('chart_title'))]));
    var dchart = el('div', { 'class': 'chart' });
    inner.appendChild(dchart);
    renderChart(dchart, dser, 'district');

    inner.appendChild(el('h2', {}, [icon('map'), document.createTextNode(t('ucs_title', { n: fc.features.length }))]));
    if (!fc.features.length) {
      inner.appendChild(noBoundariesNotice());
      inner.appendChild(actions({ ser: dser, id: p.district_id, label: p.name_en, fc: fc, props: p }));
      inner.appendChild(sourcesBlock(dser));
      return;
    }
    inner.appendChild(searchBox());
    var layer = currentLayer();
    var status = layer.id === 'status';
    var breaks = status ? null : quantiles(fc.features.map(function (f) { return f.properties[layer.id]; }));
    var rows = fc.features.slice().sort(function (a, b) {
      var av = valueOf(a.properties), bv = valueOf(b.properties);
      return (bv == null ? -1e9 : bv) - (av == null ? -1e9 : av);
    }).filter(matchQuery(function (q) { return q.uc_name_en; }));
    var list = el('ul', { 'class': 'list' });
    rows.forEach(function (f) {
      var u = f.properties, st = statusById ? statusById[u.uc_id] : u.status;
      var dot = status ? COLORS[st] : haColor(u[layer.id], breaks);
      var row = listRow(dot, u.uc_name_en, valueText(u), function () { openUC(u.district_id, u.uc_id); },
        !status && u[layer.id] == null);
      list.appendChild(row);
      if (status) movement(u.uc_id, row);
    });
    if (!rows.length) list.appendChild(el('li', { 'class': 'hint', text: t('no_match') }));
    inner.appendChild(list);
    inner.appendChild(el('p', { 'class': 'hint', text: t('tap_uc') }));
    inner.appendChild(actions({ ser: dser, id: p.district_id, label: p.name_en, fc: fc, props: p,
      statusById: statusById }));
    inner.appendChild(sourcesBlock(dser));
  }

  // ------------------------------------------------------------------ union council
  function openUC(did, ucId) {
    var prevLevel = state.level;
    state.level = 'uc'; state.districtId = did; state.ucId = ucId;
    setLoading(true);
    Promise.all([loadUCs(did), series(ucId)]).then(function (res) {
      var fc = res[0], ser = res[1];
      var f = fc.features.filter(function (x) { return x.properties.uc_id === ucId; })[0];
      if (!f) { openDistrict(did); return; }
      return statusesFor(fc.features, 'uc_id').then(function (st) {
        if (!districtLayer) drawDistricts(null);
        renderLegend(ensureUCs(did, fc, st));
        renderUC(f, ser, fc);
        showPanel(true);
        var layer = ucLayer.getLayers().filter(function (l) { return l.feature.properties.uc_id === ucId; })[0];
        // Only move the camera when arriving from another level; a period or
        // layer change inside the same union council keeps the view.
        if (layer && window.innerWidth > cfg.breakpoints.mobile && prevLevel !== 'uc') fit(layer.getBounds(), 48);
        setLoading(false);
      });
    }).catch(function (err) {
      setLoading(false);
      panelError(err);
    });
    history.replaceState(null, '', '#' + ucId);
  }

  // Back from a union council to its district: keep the camera, the search
  // text, the period and the layer; on a phone make sure the panel is visible.
  function backToDistrict(did) { openDistrict(did, { keepView: true, showPanel: true }); }

  function renderUC(f, ser, fc) {
    var p = f.properties, inner = panelShell();
    var id = A.identity(p, 'uc');
    inner.appendChild(el('div', { 'class': 'crumbs' }, [
      el('button', { onclick: function () { openProvince(); } }, [icon('chevron-left', 'icon-sm'), document.createTextNode(t('province'))]),
      icon('chevron-right', 'icon-sm'),
      el('button', { onclick: function () { backToDistrict(p.district_id); } }, [document.createTextNode(nameOf(p))]),
      el('span', { 'class': 'here', 'aria-current': 'page', text: p.uc_name_en })]));
    inner.appendChild(el('div', { 'class': 'title-row' }, [el('h1', { text: p.uc_name_en })]));
    inner.appendChild(el('p', { 'class': 'sub', text: t('uc_sub', { district: nameOf(p) }) }));
    inner.appendChild(contextLine(ser));

    inner.appendChild(el('h2', {}, [icon('info'), document.createTextNode(t('identification'))]));
    inner.appendChild(Stats.rows([
      { label: t('id_label'), value: id.id, availability: 'missing' },
      { label: t('district_label'), value: nameOf(p), availability: 'missing' },
      { label: t('level_label'), value: t('level_uc'), availability: 'missing' },
      { label: t('period_label'), value: dekadLabel(meta.dekads[state.dekadIndex]), availability: 'missing' }
    ]));
    inner.appendChild(el('p', { 'class': 'hint', text: t('unit_note') }));

    inner.appendChild(el('h2', {}, [icon('droplet'), document.createTextNode(t('water_title'))]));
    inner.appendChild(statusCard(currentFor(ser, p), p));
    inner.appendChild(trendLine(ser));

    inner.appendChild(el('h2', {}, [icon('sprout'), document.createTextNode(t('land_title'))]));
    inner.appendChild(hectares(p));
    if (!hasCropType()) inner.appendChild(cropTypeNotice());

    inner.appendChild(el('h2', {}, [icon('layers'), document.createTextNode(t('layers'))]));
    inner.appendChild(LayerControl.render({
      currentId: currentLayer().id, meta: meta, features: fc.features, t: t, onSelect: setLayer
    }));

    inner.appendChild(el('h2', {}, [icon('chart'), document.createTextNode(t('chart_title'))]));
    var chart = el('div', { 'class': 'chart' });
    inner.appendChild(chart);
    renderChart(chart, ser, 'uc');
    inner.appendChild(actions({ ser: ser, id: p.uc_id, label: p.uc_name_en, props: p }));
    inner.appendChild(sourcesBlock(ser));
    inner.appendChild(el('div', { 'class': 'panel-back' }, [
      el('button', { 'class': 'btn ghost', type: 'button', onclick: function () { backToDistrict(p.district_id); } },
        [icon('chevron-left', 'icon-sm'), document.createTextNode(t('back_to_district', { district: nameOf(p) }))])]));
  }

  // ------------------------------------------------------------------ pieces
  function panelShell() {
    var panel = qs('panel');
    panel.innerHTML = '';
    // phone only (hidden by CSS on wider screens): return to the map
    panel.appendChild(el('button', { 'class': 'panel-close', type: 'button', 'aria-label': t('show_map'),
      onclick: function () { showPanel(false); } }, [icon('close', 'icon-sm')]));
    var inner = el('div', { 'class': 'panel-inner' });
    panel.appendChild(inner);
    panel.scrollTop = 0;
    motion.reveal(inner);
    return inner;
  }
  function currentFor(ser, p) { return A.waterBalanceAt(ser, state.dekadIndex, p, isLatest()); }
  function matchQuery(getter) {
    var q = state.query.trim().toLowerCase();
    return function (f) { return !q || getter(f.properties).toLowerCase().indexOf(q) >= 0; };
  }
  function searchBox() {
    var input = el('input', { type: 'search', value: state.query, placeholder: t('search_ph'),
      'aria-label': t('search_ph'), oninput: function (e) {
        state.query = e.target.value;
        var pos = e.target.selectionStart;
        rerender(true);
        var again = document.querySelector('.search input');
        if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) {} }
      } });
    var box = el('div', { 'class': 'search' }, [icon('search', 'icon-sm'), input]);
    if (state.query) box.appendChild(el('button', { type: 'button', 'aria-label': t('clear'),
      onclick: function () { state.query = ''; rerender(true); } }, [icon('close', 'icon-sm')]));
    return box;
  }
  function listRow(color, name, value, onclick, muted) {
    return el('li', { onclick: onclick, tabindex: '0', onkeydown: function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onclick(); }
    } }, [
      el('span', { 'class': 'dot', style: 'background:' + color }),
      el('span', { 'class': 'nm', text: name }),
      value ? el('span', { 'class': 'val num' + (muted ? ' muted' : ''), text: value }) : null,
      icon('chevron-right', 'go icon-sm')
    ]);
  }
  // a small arrow next to the value: did this unit get drier or wetter?
  function movement(id, row) {
    series(id).then(function (ser) {
      if (!ser || !ser.dekads || state.dekadIndex < 1) return;
      var now = ser.dekads[state.dekadIndex], prev = ser.dekads[state.dekadIndex - 1];
      if (!now || !prev || now.deficit_mm == null || prev.deficit_mm == null) return;
      var diff = now.deficit_mm - prev.deficit_mm;
      if (Math.abs(diff) < 1) return;
      var val = row.querySelector('.val');
      if (!val) return;
      var mark = el('span', { 'class': 'move ' + (diff > 0 ? 'worse' : 'better'),
        title: (diff > 0 ? '+' : '') + fmtMm(diff) + ' ' + t('mm') + ' ' + t('vs_previous'),
        text: diff > 0 ? '\u25B2' : '\u25BC' });
      val.parentNode.insertBefore(mark, val);
    });
  }
  function statusCard(cur, p) {
    var st = cur.status || 'nodata';
    var card = el('div', { 'class': 'status-card' });
    card.appendChild(el('div', { 'class': 'status-bar ' + st }));
    var body = el('div', { 'class': 'status-body' });
    body.appendChild(el('span', { 'class': 'status-tag ' + st }, [
      icon(st === 'green' ? 'check' : st === 'nodata' ? 'info' : 'alert', 'icon-sm'),
      document.createTextNode(t('status_' + st))]));
    if (st === 'nodata') {
      body.appendChild(el('p', { 'class': 'status-what', text: !p.crop_ha ? t('nodata_no_crop') : t('nodata_missing') }));
      card.appendChild(body);
      return card;
    }
    var def = cur.deficit_mm;
    body.appendChild(el('div', { 'class': 'status-big' }, [
      el('span', { 'class': 'v num', text: fmtMm(Math.abs(def)) }),
      el('span', { 'class': 'u', text: t('mm') + ' ' + (def > 0 ? t('deficit') : t('surplus')) })]));
    body.appendChild(el('div', { 'class': 'balance' }, [
      el('div', {}, [el('div', { 'class': 'k' }, [icon('droplet', 'icon-sm'), document.createTextNode(t('et'))]),
        el('div', { 'class': 'v num' }, [document.createTextNode(fmtMm(cur.et_mm)), el('small', { text: ' ' + t('mm') })])]),
      el('div', {}, [el('div', { 'class': 'k' }, [icon('rain', 'icon-sm'), document.createTextNode(t('rain'))]),
        el('div', { 'class': 'v num' }, [document.createTextNode(fmtMm(cur.rain_mm)), el('small', { text: ' ' + t('mm') })])])]));
    body.appendChild(el('p', { 'class': 'status-what',
      text: t('status_sentence', { ha: fmtInt(p.crop_ha), basis: t('basis_' + (meta.status_basis === 'cropland' ? 'cropland' : 'irrigated')) }) }));
    body.appendChild(el('p', { 'class': 'status-rule', text: thresholdText(st) }));
    card.appendChild(body);
    return card;
  }
  function thresholdText(st) {
    var m = meta.thresholds.amber.max_deficit_mm;
    return st === 'green' ? t('rule_green') : st === 'amber' ? t('rule_amber', { max: m }) : t('rule_red', { max: m });
  }
  function trendLine(ser) {
    if (!ser || !ser.dekads.length || ser.dekads[ser.dekads.length - 1].deficit_mm == null) return el('span');
    var rows = ser.dekads, run = 0;
    for (var i = rows.length - 1; i >= 1; i--) {
      if (rows[i].deficit_mm != null && rows[i - 1].deficit_mm != null && rows[i].deficit_mm > rows[i - 1].deficit_mm) run++;
      else break;
    }
    var up = run >= 1;
    return el('p', { 'class': 'trend' + (run >= 2 ? ' up' : '') }, [
      icon(up ? 'alert' : 'check', 'icon-sm'),
      el('span', { text: run >= 2 ? t('trend_up', { n: run + 1 }) : run === 1 ? t('trend_up_one') : t('trend_flat') })]);
  }
  function hectares(p) {
    return Stats.grid(Stats.fromMeasurements(A.measurements(p, meta)));
  }
  function cropTypeNotice() {
    return el('div', { 'class': 'notice' }, [icon('info', 'icon-sm'),
      el('span', {}, [document.createTextNode(t('crop_type_notice') + ' '),
        el('a', { href: 'methods.html', text: t('read_methods') })])]);
  }
  function shareButton() {
    var btn = el('button', { 'class': 'btn ghost', type: 'button' },
      [icon('external', 'icon-sm'), el('span', { text: t('share') })]);
    btn.addEventListener('click', function () {
      var url = location.href;
      var done = function () {
        btn.lastChild.textContent = t('copied');
        setTimeout(function () { btn.lastChild.textContent = t('share'); }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { prompt(t('share'), url); });
      } else {
        prompt(t('share'), url);
      }
    });
    return btn;
  }
  // A download button that is disabled when there is nothing to export and
  // reports a failed export instead of pretending it worked.
  function exportButton(labelKey, rows, filename, ghost) {
    var label = el('span', { text: t(labelKey) });
    var btn = el('button', { 'class': 'btn' + (ghost ? ' ghost' : ''), type: 'button' },
      [icon('download', 'icon-sm'), label]);
    if (!rows) {
      btn.disabled = true;
      btn.setAttribute('title', t('export_unavailable'));
      return btn;
    }
    btn.addEventListener('click', function () {
      var res = exporter.download(filename, rows);
      if (res.ok) return;
      label.textContent = t('export_failed');
      btn.classList.add('failed');
      setTimeout(function () { label.textContent = t(labelKey); btn.classList.remove('failed'); }, 2500);
    });
    return btn;
  }
  // ctx: { ser, id, label, props, fc (district only), statusById }
  function actions(ctx) {
    var box = el('div', { 'class': 'actions' });
    box.appendChild(exportButton('download_csv',
      exporter.seriesRows(ctx.ser, meta, ctx.id, ctx.label), exporter.seriesFilename(ctx.id)));
    if (ctx.fc) {
      var period = currentPeriod();
      var seriesById = {};
      // district table uses the series already cached for the current period
      ctx.fc.features.forEach(function (f) {
        var cached = data.cached(f.properties.uc_id);
        if (cached) seriesById[f.properties.uc_id] = cached;
      });
      box.appendChild(exportButton('download_uc_table',
        exporter.districtTableRows(ctx.fc, meta, ctx.props, period, ctx.statusById, seriesById),
        exporter.tableFilename(ctx.id, period), true));
    }
    box.appendChild(el('a', { 'class': 'btn ghost', download: '',
      href: DATA() + (state.level === 'uc' ? 'ucs/' + state.districtId + '.geojson' : 'districts.geojson') },
      [icon('download', 'icon-sm'), document.createTextNode(t('download_geojson'))]));
    box.appendChild(shareButton());
    return box;
  }
  function sourcesBlock(ser) {
    var box = el('div', { 'class': 'sources' });
    box.appendChild(el('div', {}, [el('b', { text: t('sources') })]));
    A.sources(meta).forEach(function (s) {
      box.appendChild(el('div', { 'class': 'src' + (s.live ? '' : ' off') }, [
        icon(s.live ? 'check' : 'close', 'icon-sm'),
        el('span', { text: s.name + (s.live ? '' : ' — ' + t('not_connected')) })]));
    });
    box.appendChild(el('div', { 'class': 'stamp', text: t('generated', { ts: stamp((ser && ser.generated_at) || meta.generated_at) }) }));
    return box;
  }

  // ------------------------------------------------------------------ chart
  // Builds the ET-versus-rain spec for one unit and hands it to the chart
  // component. The spec carries only values the series supplies.
  function waterBalanceSpec(ser, level) {
    var wb = A.waterBalance(ser, meta);
    if (!wb) return null;
    var x = wb.periods.map(function (d) { return fmtDate(d.start); });
    var first = wb.periods[0], last = wb.periods[wb.periods.length - 1];
    return {
      x: x,
      series: [
        { key: 'et', name: t('et'), kind: 'bar', color: cfg.chart.demand, values: wb.points.map(function (p) { return p.et_mm; }) },
        { key: 'rain', name: t('rain'), kind: 'bar', color: cfg.chart.rain, values: wb.points.map(function (p) { return p.rain_mm; }) },
        { key: 'deficit', name: t('deficit'), kind: 'line', color: cfg.chart.deficit, values: wb.points.map(function (p) { return p.deficit_mm; }) }
      ],
      unit: t('mm'), missing: wb.missing, total: wb.total,
      meta: {
        period: first && last ? fmtDate(first.start) + ' – ' + fmtDate(last.end) : null,
        level: levelLabel(level),
        source: wb.et_method === 'wapor_aeti' ? t('demand_actual') : t('demand_ref'),
        generated: wb.generated_at ? stamp(wb.generated_at) : null
      },
      tableHead: [t('dekad'), t('et'), t('rain'), t('deficit')],
      tableRows: wb.points.map(function (p) { return [dekadLabel(p), fmtMm(p.et_mm), fmtMm(p.rain_mm), fmtMm(p.deficit_mm)]; })
    };
  }
  function renderChart(node, ser, level) {
    Chart.render(node, waterBalanceSpec(ser, level));
  }
  // ------------------------------------------------------------------ language, boot
  function applyLang() {
    i18n.applyRoot();
    i18n.apply(document);
    document.title = t('app_title');
    qs('langSelect').value = state.lang;
    try { localStorage.setItem(cfg.langStorageKey, state.lang); } catch (e) {}
    fillDekads();
    syncTemporal();
    qs('footGenerated').textContent = t('generated', { ts: stamp(meta.generated_at) });
    qs('footSources').textContent = t('footer_sources');
    qs('mapToggleLabel').textContent = document.body.classList.contains('show-map') ? t('show_details') : t('show_map');
  }
  var playTimer = null;
  function setPlaying(on) {
    state.playing = on;
    var btn = qs('playBtn');
    btn.classList.toggle('on', on);
    // the icon is the <use> inside the button; firstChild may be whitespace
    var use = btn.querySelector('use');
    if (use) use.setAttribute('href', on ? '#i-pause' : '#i-play');
    btn.setAttribute('aria-label', on ? t('pause') : t('play'));
    if (playTimer) { clearInterval(playTimer); playTimer = null; }
    if (!on) return;
    playTimer = setInterval(function () {
      state.dekadIndex = (state.dekadIndex + 1) % meta.dekads.length;
      qs('dekadSelect').value = state.dekadIndex;
      rerender(true);
    }, 1500);
  }
  function fillDekads() {
    var sel = qs('dekadSelect');
    sel.innerHTML = '';
    meta.dekads.forEach(function (d, i) {
      sel.appendChild(el('option', { value: i,
        text: dekadLabel(d) + (i === meta.dekads.length - 1 ? ' · ' + t('latest') : '') }));
    });
    sel.value = state.dekadIndex;
  }
  function rerender(keepView) {
    if (state.level === 'uc') openUC(state.districtId, state.ucId);
    else if (state.level === 'district') openDistrict(state.districtId, keepView !== false);
    else openProvince();
  }

  function boot() {
    initMap();
    data.setOnOffline(function () { var b = qs('offlineBadge'); if (b) b.hidden = false; });
    Promise.all([
      data.getJSON('meta.json', Math.floor(Date.now() / 3.6e6)),
      data.getText(cfg.stringsUrl)
    ]).then(function (res) {
      meta = res[0]; data.setMeta(meta); i18n.setStrings(res[1]);
      state.dekadIndex = meta.dekads.length - 1;
      qs('demoBadge').hidden = meta.mode === 'live';
      return data.getJSON('districts.geojson');
    }).then(function (fc) {
      districts = fc;
      buildMapControls();
      applyLang();
      qs('langSelect').addEventListener('change', function (e) { state.setLang(e.target.value); applyLang(); rerender(true); });
      qs('dekadSelect').addEventListener('change', function (e) {
        setPlaying(false);
        state.dekadIndex = Number(e.target.value);
        rerender(true);
      });
      qs('playBtn').addEventListener('click', function () { setPlaying(!state.playing); });
      // Escape steps back up a level; the map keeps keyboard focus usable
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
        if (state.level === 'uc') backToDistrict(state.districtId);
        else if (state.level === 'district') openProvince();
      });
      var hash = location.hash.slice(1);
      if (/^PK\.KP\.[A-Z]{3}\./.test(hash)) openUC(hash.split('.').slice(0, 3).join('.'), hash);
      else if (/^PK\.KP\.[A-Z]{3}$/.test(hash)) openDistrict(hash);
      else openProvince();
    }).catch(function (err) {
      setLoading(false);
      states.showError(qs('panel'), err);
    });
  }
  boot();
})();
