# Derived indicators (contract v0.3)

Stage 1 adds derived indicators that are computed **inside the pipeline** from
already-fetched inputs. They are additive: every v0.2 file keeps its shape, and
the site keeps working if it ignores the new files.

Two output folders are introduced:

- `data/indicators/<indicator_id>/<unit_id>.json` — one file per unit, for
  time-based indicators (period `dekad`).
- `data/static/<unit_id>.json` — one file per unit, for static indicators
  (period `static`).

`meta.json` gains an `indicators` registry (id, unit, period, source, method
parameters, resolution) and a `nasa_power` / `srtm` entry under `sources`. Each
district and tehsil feature also carries the latest value of each indicator as a
property (`frost_days`, `gdd`, `t_mean`, `elev_m`, `slope_deg`) so the map can
colour by it without a second request.

Missing values are written as `null` (or omitted for a unit with no valid
pixels); they are never filled with zero.

## Time-based (NASA POWER)

Source: `power.larc.nasa.gov/api/temporal/daily/point`, community `AG`. This is
a **reanalysis / modelled product on a coarse grid (~0.5° ≈ 55 km)**, not a
station measurement. It is already the source of the v0.2 rainfall layer, so
these indicators add no new download. Values are per unit (point sample at the
polygon centroid) per dekad, matching the six dekads in `meta.json`.

| id | unit | aggregation | method |
|---|---|---|---|
| `frost_days` | days | count | number of days with `T2M_MIN` below the frost threshold |
| `gdd` | degree-days | sum | `Σ max((T2M_MAX + T2M_MIN)/2 − base, 0)` |
| `t_mean` | degC | mean | mean of `(T2M_MAX + T2M_MIN)/2` |

### Parameters pending science-lead approval

These are documented defaults, not classifications, and must be confirmed by the
science lead before they are presented as agronomic guidance:

- `frost_threshold_c = 0.0` (water freezing point).
- `base_temp_c = 10.0` (generic GDD base; **not** crop-specific).

A dekad with more than two days missing is written as `null` with
`quality: "insufficient_days"`; otherwise `quality: "ok"` and `valid_days`
records how many days actually contributed.

## Static (SRTM terrain)

Source: SRTMGL1 v003 (NASA/USGS), 1 arc-second (~30 m), downloaded keylessly from
the AWS elevation-tiles "skadi" store. For each polygon the pipeline rasterises
the polygon onto the DEM grid and reports, over valid pixels only (void
`-32768` excluded):

| field | meaning |
|---|---|
| `elevation_m.mean/min/max` | elevation statistics |
| `slope_deg.mean/max` | slope from the local DEM gradient |
| `slope_class_share` | share of pixels in each slope band |
| `valid_pixels` | number of DEM pixels inside the polygon |

Slope bands are `0-2`, `2-5`, `5-10`, `10-15`, `gt15` degrees (lower-inclusive,
last band open). They are a conventional display grouping and are **pending
science-lead approval**; they are not a suitability judgement.

Registered static indicators: `elev_m` (m, mean) and `slope_deg` (deg, mean).

## Limitations

- POWER is modelled at ~55 km; a unit value describes the model grid cell, not
  the whole administrative area, and never an individual farm.
- SRTM is a 2000-era surface (not bare-earth) DEM; slope is smoothed by the
  ~30 m sampling.
- Terrain statistics are area-weighted by DEM pixels inside the polygon, so a
  polygon edge clipped by a tile boundary still uses only the pixels available.
