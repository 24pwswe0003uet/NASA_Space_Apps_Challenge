/* Layer catalog. The single source of truth for which map layers exist, how they
   are grouped in the interface, whether they are time-based, and which data source
   backs each one. app.js reads this instead of hardcoding a layer list, so adding a
   layer is a one-line change here and availability follows the meta.json sources. */
(function () {
  'use strict';

  var LAYERS = [
    { id: 'status', nameKey: 'layer_status', icon: 'droplet', type: 'categorical',
      temporal: true, unit: 'mm', category: 'water', source: null },
    { id: 'crop_ha', nameKey: 'layer_crop_ha', icon: 'sprout', type: 'continuous',
      temporal: false, unit: 'ha', category: 'land', source: 'cropland' },
    { id: 'wheat_ha', nameKey: 'layer_wheat_ha', icon: 'wheat', type: 'continuous',
      temporal: false, unit: 'ha', category: 'crop_type', source: 'crop_type' },
    { id: 'maize_ha', nameKey: 'layer_maize_ha', icon: 'maize', type: 'continuous',
      temporal: false, unit: 'ha', category: 'crop_type', source: 'crop_type' },
    { id: 'irrigated_ha', nameKey: 'layer_irrigated_ha', icon: 'irrigation', type: 'continuous',
      temporal: false, unit: 'ha', category: 'crop_type', source: 'crop_type' }
  ];

  var CATEGORIES = [
    { id: 'water', nameKey: 'cat_water' },
    { id: 'land', nameKey: 'cat_land' },
    { id: 'crop_type', nameKey: 'cat_crop_type' }
  ];

  window.ATLAS_LAYERS = { default: 'status', layers: LAYERS, categories: CATEGORIES };
})();


