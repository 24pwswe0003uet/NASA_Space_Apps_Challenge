/* ET versus Rainfall comparison chart.
   When the confirmed data contract provides both actual evapotranspiration and
   rainfall observations for the selected geographic area, this component
   renders a professional comparison chart.
   Data is received through the chart service adapter — the component never
   calculates scientific indicators or fetches data itself.
   Placeholder state: renders "no series" when no data is available,
   never displays fake values.
   Responsive, accessible, clean scientific visualization style. */

(window.Atlas = window.Atlas || {}).components = (window.Atlas.components || {});

Atlas.components.etRainfallChart = (function () {
  'use strict';

  var util = Atlas.util;
  var t = Atlas.i18n.t;
  var cfg = Atlas.config;

  /* Render the chart into the given DOM node.
     ser: time-series data object with labels, etSeries, rainSeries, deficitSeries
        (may be null/empty — component handles gracefully).
     node: DOM element (typically a div.chart) where Plotly will render. */
  function render(node, ser) {
    if (!ser || !ser.labels || ser.labels.length === 0) {
      // No data — show professional placeholder, never fake
      node.innerHTML = [
        '<p class="hint">' + t('no_series_no_data') + '</p>',
        '<p class="hint small">' + t('data_pending') + '</p>'
      ].join('');
      return;
    }

    // Load Plotly if not already loaded
    if (window.Plotly) {
      renderWithPlotly(node, ser);
    } else {
      // Lazy-load Plotly script
      var s = document.createElement('script');
      s.src = cfg.plotlyUrl;
      s.onload = function () { renderWithPlotly(node, ser); };
      s.onerror = function () {
        // Fallback table
        node.innerHTML = [
          '<table class="chart-table">',
            '<tr>',
              '<th>' + t('dekad') + '</th>',
              '<th>' + t('et') + '</th>',
              '<th>' + t('rain') + '</th>',
              '<th>' + t('deficit') + '</th>',
            '</tr>'
        ].join('');
        if (ser.labels && ser.etSeries) {
          ser.labels.forEach(function (label, i) {
            var tr = document.createElement('tr');
            tr.innerHTML = [
              '<td>' + label + '</td>',
              '<td class="num">' + (ser.etSeries[i] != null ? Atlas.util.fmtMm(ser.etSeries[i]) : t('not_connected')) + '</td>',
              '<td class="num">' + (ser.rainSeries[i] != null ? Atlas.util.fmtMm(ser.rainSeries[i]) : t('not_connected')) + '</td>',
              '<td class="num">' + (ser.deficitSeries[i] != null ? Atlas.util.fmtMm(ser.deficitSeries[i]) : t('not_connected')) + '</td>'
            ].join('');
            node.firstChild.parentNode.appendChild(tr);
          });
        }
      };
      document.head.appendChild(s);
    }
  }

  function renderWithPlotly(node, ser) {
    var layout = {
      barmode: 'group',
      height: 236,
      margin: { l: 38, r: 10, t: 6, b: 30 },
      legend: { orientation: 'h', y: 1.18, x: 0, font: { size: 11 } },
      yaxis: {
        title: { text: t('mm'), font: { size: 11 } },
        gridcolor: '#eef1f6',
        zerolinecolor: '#cbd5e1'
      },
      xaxis: { tickfont: { size: 10 } },
      hovermode: 'x unified',
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { family: 'Inter, system-ui, sans-serif', color: '#39414d' }
    };

    var data = [
      {
        type: 'bar',
        name: t('et'),
        x: ser.labels,
        y: ser.etSeries,
        marker: { color: '#0b3d91' },
        hovertemplate: '%{y:.1f} mm<extra>' + t('et') + '</extra>'
      },
      {
        type: 'bar',
        name: t('rain'),
        x: ser.labels,
        y: ser.rainSeries,
        marker: { color: '#9fb3c8' },
        hovertemplate: '%{y:.1f} mm<extra>' + t('rain') + '</extra>'
      },
      {
        type: 'scatter',
        mode: 'lines+markers',
        name: t('deficit'),
        x: ser.labels,
        y: ser.deficitSeries,
        line: { color: '#c2250f', width: 2 },
        marker: { size: 6 },
        hovertemplate: '%{y:.1f} mm<extra>' + t('deficit') + '</extra>'
      }
    ];

    Plotly.newPlot(node, data, layout, { displayModeBar: false, responsive: true });
  }

  return { render: render };
})();