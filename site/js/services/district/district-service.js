/* District data service: domain objects for district-level exploration.
   The backend team will connect these to actual NASA/partner datasets.
   Current placeholders return structured skeletons ready for real data integration.
   Never fabricate values — missing data renders as no-data, never zero. */

/* eslint-enviroment browser, es6 */

(window.Atlas = window.Atlas || {}).data = (window.Atlas.data || {});

Atlas.data.districtService = (function () {
  'use strict';

  var services = {};

  /* ---- District meta: name, area, identification ------------------------ */
  services.districtMeta = function (did) {
    // Placeholder: will be populated from backend contract
    return {
      id: did,
      nameEn: null,          // e.g. "Abbottabad"
      nameUr: null,          // Urdu name
      namePs: null,          // Pashto name
      province: 'Khyber Pakhtunkhwa',
      geoid: null,           // e.g. "PK.KP.ABB"
      areaHa: null,          // total geographic area in hectares
      // observationPeriod will be filled from meta.json temporal data
      observationPeriod: null
    };
  };

  /* ---- Available agricultural measurements (placeholder) --------------- */
  services.agriculturalStats = function (did) {
    // Placeholder structure — backend will fill with real measurements
    return {
      wheatHa: null,         // winter cereals area (ha)
      maizeHa: null,         // maize area (ha)
      cropHa: null,          // total cropland area (ha)
      irrigatedHa: null,     // irrigated area (ha)
      cropType: null,        // dominant crop type name
      // These are potential fields — only display when backend confirms
      // Never fabricate values; missing renders as no-data
    };
  };

  /* ---- Environmental measurements (placeholder) ----------------------- */
  services.environmentalStats = function (did) {
    // Placeholder — backend connects to SMAP, GPM/IMERG, etc.
    return {
      soilMoisture: null,    // volumetric water content
      rainfallMm: null,      // ten-day rainfall (mm)
      etMm: null,            // evapotranspiration (mm)
      landTempC: null,       // land-surface temperature (°C)
      vegetationIndex: null, // e.g. NDVI or similar
      // Only display when backend confirms data source and coverage
    };
  };

  /* ---- Time-series data (placeholder) -------------------------------- */
  services.timeSeries = function (did) {
    // Placeholder — backend provides ordered observations with dates/units
    return {
      labels: [],            // e.g. ['2026-09-11', '2026-09-20', ...]
      etSeries: [],          // et_mm values
      rainSeries: [],        // rain_mm values
      deficitSeries: [],     // deficit_mm values
      // Only render chart when backend provides actual series data
      // Chart component must handle empty/series-less case gracefully
    };
  };

  /* ---- CSV export data (placeholder) -------------------------------- */
  services.exportData = function (did) {
    // Placeholder CSV structure — backend provides actual rows/columns
    return {
      // Column headings will include: id, name, area_ha, wheat_ha, maize_ha,
      // irrigated_ha, crop_type, soil_moisture_mm, rainfall_mm, et_mm, deficit_mm, status
      // Units will be supplied by backend metadata
      // Missing values: empty strings / null, NOT zero
      rows: [],
      filename: 'kp-atlas-district-' + did + '.csv',
      // Include observation period when applicable
      periodLabel: null
    };
  };

  return services;
})();