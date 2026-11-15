# Data Source Assessment Report — KP Open Farm Atlas

| Field | Value |
|---|---|
| Stage | 1 — Source investigation (no data generated) |
| Date | 2026-11-15 |
| Scope | The organizer resource list (NASA, USDA/USGS, FAO, community, ESA, ECMWF) assessed for Khyber Pakhtunkhwa (KP), Pakistan |
| Baseline | Repository `main` @ `8a11c1e`; data contract v0.2 (`docs/data-contract.md`, `data/`, `pipeline/`) |
| Author | Frontend owner (acting on the data-engineering master prompt); for review by the backend/data and science leads |
| Status key | **A** suitable, use now · **B** suitable with work or credentials · **C** context only / low priority · **X** not suitable for KP |

> This document assesses; it does not change `data/`, the pipeline or the contract. Every product identifier, resolution and access route below was checked against provider documentation on the date above; items marked *to verify* were not independently confirmed and must be before use.

---

## 1. Where the project already stands

The pipeline (`pipeline/`) and contract v0.2 already deliver, per district (31) and tehsil (122):

| Role | Source in use | Status in `meta.sources` |
|---|---|---|
| Rainfall (dekadal) | NASA POWER `PRECTOTCORR` (MERRA-2 bias-corrected), daily point API, 0.5° × 0.625° | live |
| Water demand (dekadal) | FAO-56 Penman–Monteith ET₀ computed in `pipeline/et0.py` from NASA POWER daily weather | live (fallback) |
| Actual ET (preferred) | FAO WaPOR v3 dekadal AETI via Earth Engine | **not live** — needs `EE_SERVICE_ACCOUNT_KEY` |
| Cropland extent | ESA WorldCover 2021 v200 class 40, 10 m | live |
| Crop type / irrigation | ESA WorldCereal 2021 v100 via Earth Engine | **not live** — needs Earth Engine |
| Boundaries | geoBoundaries gbOpen PAK ADM2 (2019, 31 districts) and ADM3 (2017, 122 tehsils), release `9469f09` | live |
| Validation reference | PBS Agricultural Census 2024 (to be typed into `pipeline/census_2024.csv`) | empty |

Two facts shape everything below:

1. **The contract is unit-aggregate and dekadal.** New indicators are most useful if they arrive as area-weighted aggregates per `district_id` / `uc_id` on the same dekad calendar, or as static per-unit values. Pixel-level products are an input to the pipeline, not something the frontend consumes.
2. **Blocker D-13 (AGENTS.md §11):** `data/meta.json` and `data/validation.csv` on `main` were overwritten by merge `041ec3e` with a schema proposal and a blank template. `pipeline/validate_data.py` fails (`KeyError: 'dekads'`) and the site cannot boot from committed data. No new dataset should be integrated until the v0.2 runtime files are restored (they exist at `ff37a81`).

---

## 2. Geographic frame

| Need | Current | Options assessed | Recommendation |
|---|---|---|---|
| Province / district | geoBoundaries ADM1/ADM2 (2019 districts, 31 not 35; Chitral, Kohistan, Torghar splits missing) | **OCHA COD-AB Pakistan** (HDX `cod-ab-pak`, WFP SDI / ITOS, admin 0–3, reviewed Sept 2024, 160 districts nationally, P-codes); GADM 4.1 (download was unreachable from the build network, `docs/sources.md`) | Move to COD-AB for districts and tehsils when the data lead can: it carries P-codes, is the humanitarian standard for Pakistan and is maintained. Keep `pipeline/uc_ids.csv` append-only so existing IDs survive. |
| Tehsil (current level 3) | geoBoundaries ADM3 (2017) | COD-AB admin3 = tehsil | Same as above. |
| Union council (true level 4) | **none** — keys are `uc_*` but polygons are tehsils | HDX "Pakistan Union Council Boundaries along with other admin boundaries" (Alhasan Systems, 2017; HDX lists it as the company's sole property — **licence must be confirmed before use**); PCO 2010-flood UC layer ("Pakistan – Admin Level 4 Boundaries", provenance and currency *to verify*) | Treat real UC polygons as a separate, licence-gated task. Until then the interface must keep saying "tehsil". Do **not** derive UCs from anything else. |
| CRS | WGS 84 (EPSG:4326), lon/lat order, checked by `validate_data.py` | — | Keep. Clip rasters in their native CRS; aggregate; store results in 4326. |

---

## 3. Source-by-source assessment

Columns: product (exact identifier) · coverage & resolution · cadence/latency · units · access · licence · KP suitability · Atlas role · aggregation level the data can honestly support · status.

### 3.1 NASA

| # | Source | Product | Coverage · resolution | Cadence · latency | Units | Access | KP | Atlas role | Honest level | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **NASA POWER** | `temporal/daily/point` (and `regional`), community AG; `PRECTOTCORR`, `T2M_MAX/MIN`, `RH2M`, `WS2M`, `ALLSKY_SFC_SW_DWN`, `PS` | Global · 0.5° × 0.625° (MERRA-2 grid) | Daily · ~2–3 days | mm/day, °C, %, m/s, MJ/m²/day, kPa | HTTPS API, no key | Public domain | Yes | Rainfall; ET₀ inputs; **new:** temperature extremes, frost-risk days (count of `T2M_MIN` < threshold set by the science lead) | District, tehsil (one grid cell often covers several tehsils — must be disclosed) | **A — in use** |
| 2 | **GPM IMERG** | `GPM_3IMERGDL` (Late, daily) / `GPM_3IMERGDF` (Final, daily), **V07B** | Global 90°N–90°S · 0.1° (~10 km) | Daily · Early ~4 h, Late ~14 h, Final ~3.5 months | mm/day | GES DISC (Earthdata login), OPeNDAP/HTTPS, AWS `gesdisc-cumulus-prod-protected` | NASA open | Yes | Rainfall at 5× finer grid than POWER; the Late run is the only one usable for a weekly dekadal update, Final for re-analysis | District, tehsil (10 km) | **B** — needs Earthdata login in CI; decide Late vs Final policy with science lead |
| 3 | **SMAP** | `SPL3SMP_E` v006 (L3 enhanced radiometer, 9 km EASE-Grid 2.0, surface 0–5 cm, AM/PM) and `SPL4SMGP` (L4 root-zone, 9 km, 3-hourly, model-assimilated; current version *to verify*) | Global · 9 km | Daily composites · ~1–3 days (L3), L4 a few days | m³/m³ | NSIDC DAAC (Earthdata login), HDF5; LANCE NRT | NASA open | Yes, but 9 km over mountainous KP has retrieval-quality flags set frequently; L3 is a retrieval, L4 is a model | Soil-moisture indicator per unit, with the quality flag carried through | District; tehsil only with the valid-pixel count disclosed | **B** |
| 4 | **MODIS / VIIRS** | MODIS `MOD13Q1`/`MYD13Q1` v061 (NDVI/EVI, 250 m, 16-day); VIIRS `VNP13A1` v002 (500 m, 16-day, SNPP) and `VJ113A1` (NOAA-20) | Global · 250 m / 500 m | 16-day composites · ~1–2 weeks | index (scaled) | LP DAAC (Earthdata login), AppEEARS, Earth Engine | NASA open | Yes, **but** NASA plans to stop Terra MODIS science collection in Feb 2027 and Aqua in Sep 2027, and Suomi-NPP product delivery ceases 1 Nov 2026 | Vegetation index per unit (mean NDVI over cropland mask, with valid-pixel share) | District, tehsil | **B** — build on **VIIRS NOAA-20/21 (`VJ1`/`VJ2`) from the start**; MODIS only for history |
| 5 | **Landsat** | Via NASA **HLS v2.0**: `HLSL30` (Landsat 8/9) and `HLSS30` (Sentinel-2 A/B/C), 30 m, plus precomputed **`HLSL30_VI` / `HLSS30_VI`** (NDVI, EVI, …) | Global land · 30 m, Sentinel-2 tiling | Combined revisit ~1.6 days nominal; cloud-dependent | reflectance / index | LP DAAC Earthdata Cloud (COG, CMR-STAC `LPCLOUD`), Earth Engine | NASA open | Yes | 30 m NDVI composites per dekad over the cropland mask; the VI product removes the need to compute NDVI | District, tehsil | **B** — the preferred vegetation source; needs cloud masking (Fmask layer) and compute |
| 6 | **SRTM** | `NASADEM_HGT` v001 or `SRTMGL1` v003, 1 arc-second (~30 m) | 60°N–56°S · 30 m | Static (2000) | m | LP DAAC (Earthdata login), Earth Engine | NASA open | Yes | Static per-unit elevation (mean/min/max) and slope class share | District, tehsil (even UC when polygons exist) | **A** — one-time job, no latency issue |
| 7 | **ECOSTRESS** | `ECO_L3T_JET` **v003** (tiled, MGRS, 70 m; `ETdaily` in mm/day with `Etuncertainty`, cloud and water masks) and `ECO_L2T_LSTE` (LST, K) | 52°N–52°S · 70 m | Irregular ISS revisit, variable local time, cloud gaps; permanent gaps 2018–2023 | mm/day, K | LP DAAC Earthdata Cloud (COG) | NASA open | Covers KP (31–37°N) but no guaranteed scene per dekad per unit | LST / ET **snapshots** with their acquisition date — not a dekadal series | District at best; label every value with its scene date | **C** — demonstration value, not an operational layer |
| 8 | **NLDAS / GLDAS** | NLDAS: **North America only → X.** GLDAS: `GLDAS_NOAH025_3H` v2.1 (0.25°, 3-hourly; soil moisture by layer, ET, temperature), `GLDAS_CLSM025_DA1_D` v2.2 (daily, GRACE-assimilated) | Global · 0.25° (~25 km) | 3-hourly / daily · v2.1 ~1–2 months latency *to verify* | kg/m², W/m², K | GES DISC (Earthdata login) | NASA open | Coarse for KP; useful as modelled context and as a consistency check on SMAP/POWER | Modelled soil-moisture and ET context per district | District only | **C** (GLDAS) / **X** (NLDAS) |
| 9 | **GEDI** | `GEDI_L4A_AGB_Density` v3 (footprint biomass), `GEDI04_B` (1 km gridded) | 51.6°N–51.6°S footprints | Operating again since Jun 2024 after Mar 2023–Apr 2024 hibernation; campaign-based | Mg/ha | ORNL DAAC / LP DAAC (Earthdata login) | NASA open | Covers KP; forests only, sparse footprints, weak over cropland | None for the agricultural Atlas | — | **X** for this scope (note for a future forestry layer) |

### 3.2 USDA, USGS, PRISM, community (resources designed for the United States)

| # | Source | Coverage | KP | Status | Legitimate alternative for KP |
|---|---|---|---|---|---|
| 10 | USDA Ag Data Commons | Mostly US field studies; some global datasets | Rarely | **X** (screen individual datasets only if the science lead names one) | PBS Agricultural Census 2024 (already planned), KP Crop Reporting Service bulletins |
| 11 | Web Soil Survey (NRCS) | US only | No | **X** | **ISRIC SoilGrids v2.0** (global 250 m texture, SOC, pH, bulk density; CC BY 4.0) — not in the organizer list; propose to science lead |
| 12 | Cropland Data Layer / CropScape | US only | No | **X** | ESA WorldCereal (already planned), ESA WorldCover (in use) |
| 13 | PRISM | US only | No | **X** | ERA5-Land (below), NASA POWER climatology |
| 14 | SSURGO / STATSGO2 | US only | No | **X** | SoilGrids (as above), FAO HWSD v2 |
| 15 | NAIP | US only | No | **X** | Sentinel-2 10 m (below) |
| 16 | NLCD | US only | No | **X** | ESA WorldCover 2021 (in use) |
| 17 | CoCoRaHS | North America only | No | **X** | PMD station data if the team can obtain it; otherwise IMERG vs POWER cross-check |
| 18 | USGS NWIS | US only | No | **X** | WAPDA/PID canal and gauge data (not open; out of scope) |
| 19 | USDA AMS Market News | US only | No | **X** (also outside scope — no market features approved) | — |
| 20 | USDA NASS QuickStats | US only | No | **X** | PBS Agricultural Census 2024 |
| 21 | OpenET | Western US only | No | **X** | FAO WaPOR v3 (already planned), ECOSTRESS snapshots |
| 22 | USFS LANDFIRE | US only | No | **X** | — |

### 3.3 FAO, ESA, ECMWF

| # | Source | Product | Coverage · resolution | Cadence · latency | Units | Access | Licence | KP | Atlas role | Honest level | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 23 | **FAO GAEZ v4** | Agro-ecological suitability / attainable yield layers (static) | Global · 5 arc-min (~9 km) | Static (climate normals, scenarios) | class / kg/ha | GAEZ data portal (download) | *to verify* (GAEZ v4 terms) | Yes | Static context only; its suitability classes would read as recommendations, which AGENTS.md forbids | — | **C** — hold unless the science lead approves a clearly labelled context layer |
| 24 | **ESA Sentinel-2** | L2A surface reflectance (10 m bands); or via HLS S30 at 30 m (row 5) | Global land · 10–20 m | 5-day revisit (2 sats; 3 with S2C) | reflectance | Copernicus Data Space Ecosystem (free account; STAC/openEO), Earth Engine, HLS | Copernicus open licence | Yes | 10 m NDVI where field-scale texture matters; otherwise HLS covers it | District, tehsil | **B** — use HLS first; raw S2 only if 10 m is needed |
| 25 | **ECMWF ERA5 / ERA5-Land** | `reanalysis-era5-land` (0.1°, hourly; 2 m temperature, dewpoint, soil temperature and volumetric soil water by layer, total precipitation, potential evaporation) and the post-processed **daily statistics** datasets | Global land · 0.1° (~9 km) | Hourly · ~5 days behind real time | K, m, m³/m³ | **New CDS** (`https://cds.climate.copernicus.eu/api`, ECMWF account, `cdsapi` ≥ 0.7, licence accepted per dataset; queue times can be long) | Copernicus licence (free, attribution) | Yes | Temperature and soil-temperature context; a second rainfall opinion; frost days | District, tehsil | **B** — good value; the CDS queue makes it unsuitable for a tight weekly CI window unless requests are small and cached |

### 3.4 Already in the pipeline, not in the organizer list (for completeness)

ESA WorldCover 2021 v200 (A, in use); ESA WorldCereal 2021 v100 (B, Earth Engine); FAO WaPOR v3 L2 AETI dekadal 100 m / L1 300 m (B, Earth Engine; the scientifically preferred ET); geoBoundaries (A, in use). **CHIRPS v2/v3** (0.05° daily rainfall, UCSB CHC, open) is the usual alternative when IMERG's Earthdata login is a barrier — propose to the science lead.

---

## 4. Priority and effort

| Priority | Candidate | Why | Dependency | Effort (data lead) |
|---|---|---|---|---|
| 1 | Restore v0.2 `meta.json` / `validation.csv` (D-13) | Nothing ships until this is fixed | Data owner | 0.5 h |
| 2 | Earth Engine key → WaPOR AETI + WorldCereal | Turns on the two "not connected" sources the UI already handles | `EE_SERVICE_ACCOUNT_KEY` secret | 1 h (code exists) |
| 3 | SRTM/NASADEM terrain per unit | Static, one job, cheap, honest at every level | Earthdata login | 0.5 day |
| 4 | HLS-VI NDVI per dekad over the cropland mask | Vegetation indicator with no in-house index maths; 30 m | Earthdata login; compute (Earth Engine or cloud COG reads) | 2 days + science rules for compositing/cloud |
| 5 | IMERG Late daily → dekad | Finer rainfall than POWER; keep POWER as cross-check | Earthdata login; Late-vs-Final decision | 1 day |
| 6 | SMAP L3/L4 soil moisture per unit | Requested indicator; quality-flag handling is the work | Earthdata login; science rules for flags and valid-pixel minimum | 1–2 days |
| 7 | ERA5-Land temperature / frost days | Climate context | CDS account; queue tolerance | 1 day |
| 8 | ECOSTRESS LST/ET snapshots | Showcase only, clearly dated | Earthdata login | 1 day |
| — | GLDAS, GAEZ, GEDI, Sentinel-2 raw, all US-only sources | Context or out of scope | — | — |

---

## 5. Processing approach (common to every new indicator)

1. **Boundary frame:** the same polygons as `data/ucs/<district>.geojson`, in the raster's native CRS for the zonal step.
2. **Mask:** aggregate over the cropland mask (WorldCover class 40 at ~75 m statistics resolution, as the pipeline already does) so vegetation and water indicators describe farmland, not glaciers or towns. Record `mask_source_id` and the mask area.
3. **Quality:** apply the product's own QA/cloud/retrieval flags; **count** valid pixels and valid share per unit; do not fill gaps.
4. **Temporal:** aggregate to the dekad calendar in `meta.dekads` (sum for rain, mean for indices/moisture/temperature, documented per indicator). A unit-dekad with fewer than the science lead's minimum valid pixels or days is `null`.
5. **Units:** native product units, converted only with a documented factor (e.g. IMERG mm/day → mm/dekad by summation; SMAP m³/m³ unchanged; NDVI scale factor removed and recorded).
6. **Provenance:** every file carries `generated_at`, `source_id`, product version, retrieval date, aggregation method and valid-pixel statistics.
7. **Validation:** `pipeline/validate_data.py` extended per indicator (ranges, units, dekad alignment, null handling), run in CI as today.

---

## 6. Proposed contract extension (additive, for the data lead's decision — not applied)

Keep v0.2 files unchanged. Add, under a version bump to 0.3:

```text
data/
  indicators/<indicator_id>/<unit_id>.json      # dekadal series per unit, one file per indicator
  static/<unit_id>.json                          # terrain and other static values
meta.json
  indicators: [ { id, name, unit, period: "dekad"|"static", source_id, product_version,
                  resolution_m, mask_source_id, aggregation, valid_min_pixels, documentation } ]
```

`indicators/<indicator_id>/<unit_id>.json`:

```json
{ "unit_id": "PK.KP.CHA.TANGI", "indicator": "ndvi_cropland_mean",
  "dekads": [ { "start": "2026-11-01", "end": "2026-11-10", "value": 0.41,
                "valid_pixels": 10234, "valid_share": 0.83, "quality": "ok" } ],
  "source_id": "nasa_hls_vi_v2", "unit": "index", "generated_at": "..." }
```

Why additive: the frontend's `layers/catalog.js` + `series-adapter.js` consume a new indicator with one catalog entry and one adapter case; nothing existing breaks, and `meta.sources` keeps gating availability. Missing values stay `null`.

---

## 7. Inventory status

| Dataset | Status |
|---|---|
| NASA POWER, ESA WorldCover, geoBoundaries | Ready for frontend integration (live) |
| FAO WaPOR v3, ESA WorldCereal 2021 | Investigated · suitable · **awaiting access** (Earth Engine key) |
| SRTM/NASADEM, HLS / HLS-VI, GPM IMERG V07B, SMAP SPL3SMP_E/SPL4SMGP, ERA5-Land, Sentinel-2 (CDSE) | Investigated · suitable · awaiting access (Earthdata / CDS / CDSE accounts) and science rules |
| ECOSTRESS v003, GLDAS 2.1/2.2, GAEZ v4, GEDI L4A v3 | Investigated · context or low priority |
| MODIS v061 | Investigated · suitable for history only (missions end 2027) |
| NLDAS, Web Soil Survey, CDL, PRISM, SSURGO/STATSGO2, NAIP, NLCD, CoCoRaHS, NWIS, AMS Market News, NASS QuickStats, OpenET, LANDFIRE | Investigated · **not suitable for KP** (US / North America only) |
| Ag Data Commons | Investigated · not suitable unless a specific global dataset is named |
| PBS Agricultural Census 2024 | Awaiting manual entry (`pipeline/census_2024.csv`) |
| CHIRPS, SoilGrids, COD-AB boundaries | Suggested alternatives · not investigated in depth |

Nothing in this table is marked acquired, processed or validated.

---

## 8. Open decisions for the team

| ID | Question | Owner | Default if unanswered |
|---|---|---|---|
| S-01 | Restore v0.2 runtime `meta.json` / `validation.csv` (D-13) | Data lead | Nothing else proceeds |
| S-02 | Provide `EE_SERVICE_ACCOUNT_KEY` (project `kp-farm-atlas`) | Data lead / team lead | WaPOR and WorldCereal stay "not connected" |
| S-03 | Earthdata login in CI (secret) for IMERG, SMAP, HLS, NASADEM, ECOSTRESS | Data lead | Only POWER-based indicators possible |
| S-04 | IMERG Late (14 h) vs Final (3.5 months) for the weekly update | Science lead | Late for live, Final for re-analysis |
| S-05 | Minimum valid-pixel share and compositing rule for NDVI and soil moisture | Science lead | No vegetation/moisture layer |
| S-06 | Frost-day threshold and any temperature classes | Science lead | Show raw °C only |
| S-07 | Licence confirmation for any UC polygon source (Alhasan 2017 / PCO) | Team lead | Stay at tehsil level |
| S-08 | Move boundaries to OCHA COD-AB (P-codes) | Data lead | Keep geoBoundaries |
| S-09 | Approve the additive v0.3 contract shape (§6) | Data lead + frontend owner | No new indicators in the UI |

---

## 9. Next actions

1. Data lead resolves S-01 and S-02 (unblocks everything already built).
2. Team lead creates the Earthdata and CDS accounts and adds the secrets (S-03).
3. Data lead implements priority 3 (terrain) as the first new indicator under the §6 shape; frontend adds the catalog entry.
4. Science lead returns S-04 to S-06; then HLS-VI NDVI, IMERG and SMAP in that order.
5. Every delivered indicator comes with the §5 provenance and a `validate_data.py` rule before it is marked ready.

## 10. Sources consulted

- NASA GPM: IMERG V07 release notes and Early/Late/Final product pages (gpm.nasa.gov; GES DISC `GPM_3IMERG*` .07).
- NSIDC: `SPL3SMP_E` v006 product page; SMAP version history.
- NASA Earthdata alerts: "Transition from MODIS to VIIRS" (2 May 2025); LAADS "MODIS to VIIRS transition"; Suomi-NPP delivery end notice; `science.nasa.gov` "Terra: The End of an Era" editor's note (Terra Feb 2027, Aqua Sep 2027).
- LP DAAC: `ECO_L3T_JET` v002/v003 catalog entries; HLS project page and `HLSL30_VI`/`HLSS30_VI` v2.0 catalog entries; CMR-STAC `LPCLOUD`.
- ORNL DAAC / NASA: GEDI 2025 Science Team meeting summary; `GEDI_L4A` v3 landing page; GEDI V2 data releases 2025.
- ECMWF: "Goodbye legacy CDS" forum post (26 Sept 2024); CDS API knowledge-base pages; ERA5 family page.
- HDX / OCHA: `cod-ab-pak` (COD-AB Pakistan admin 0–3); Alhasan Systems UC boundary dataset page.
- Repository: `docs/data-contract.md`, `docs/sources.md`, `docs/methods.md`, `pipeline/*.py`, `data/meta.json` (v0.2 at `ff37a81`).
