#!/usr/bin/env python3
"""Per-unit terrain statistics from the SRTM tiles fetched by fetch_srtm.py.

For every district and tehsil polygon this rasterises the polygon onto the SRTM
1-arc-second grid and reports, over the valid pixels inside the polygon:

    elevation_m        mean / min / max
    slope_deg          mean / max   (from the local gradient of the DEM)
    slope_class_share  share of pixels in each slope band

Void pixels (-32768) are excluded, never treated as zero. Slope bands are the
conventional FAO classes; they are a display grouping, not a suitability judgement.

    python3 pipeline/terrain_stats.py [--out ../data] [--cache cache/srtm]

Outputs (additive): data/static/<unit_id>.json, plus sources.srtm and two
static entries in data/meta.json.indicators, and elev_m / slope_deg on each feature.
"""
import argparse
import glob
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
import rasterio
from rasterio.features import rasterize

from geo import bbox

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.abspath(os.path.join(HERE, "..", "data"))
DEFAULT_CACHE = os.path.join(HERE, "cache", "srtm")
HGT_SIDE = 3601
VOID = -32700
DEG_M_LAT = 110540.0
DEG_M_LON = 111320.0
# slope bands in degrees (lower-inclusive); the last band is open-ended
SLOPE_BANDS = [(0, 2), (2, 5), (5, 10), (10, 15), (15, float("inf"))]
SLOPE_LABELS = ["0-2", "2-5", "5-10", "10-15", "gt15"]
SRTM_VERSION = "SRTMGL1 v003 (NASA/USGS), 1 arc-second, via AWS elevation-tiles skadi store"


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def dump_json(path, obj, compact=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        if compact:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, fh, ensure_ascii=False, indent=1)
            fh.write("\n")


def tile_origin(tile):
    """Return (lon0, lat0) of the tile's south-west corner from its name."""
    ns, ew = tile[0], tile[3]
    lat = int(tile[1:3]) * (1 if ns == "N" else -1)
    lon = int(tile[4:7]) * (1 if ew == "E" else -1)
    return lon, lat


def load_units(bnd_dir):
    units = []
    for path in [os.path.join(bnd_dir, "districts.geojson")] + sorted(glob.glob(os.path.join(bnd_dir, "ucs", "*.geojson"))):
        if os.path.basename(path) == "all.geojson" or not os.path.exists(path):
            continue
        for f in load_json(path)["features"]:
            p = f["properties"]
            uid = p.get("uc_id") or p["district_id"]
            units.append((uid, f["geometry"], bbox(f["geometry"])))
    return units


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    ap.add_argument("--boundaries", default=os.path.join(HERE, "cache", "boundaries"))
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    units = load_units(args.boundaries)
    if not units:
        sys.exit("no boundaries found; run prepare_boundaries.py first")
    index = {uid: i + 1 for i, (uid, _, _) in enumerate(units)}
    n = len(units) + 1

    cnt = np.zeros(n, dtype=np.int64)
    elev_sum = np.zeros(n)
    elev_min = np.full(n, np.inf)
    elev_max = np.full(n, -np.inf)
    slope_sum = np.zeros(n)
    slope_max = np.zeros(n)
    band_counts = np.zeros((len(SLOPE_BANDS), n), dtype=np.int64)

    tiles = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(args.cache, "*.hgt")))
    if not tiles:
        sys.exit(f"no .hgt tiles in {args.cache}; run fetch_srtm.py first")
    print(f"{len(units)} units, {len(tiles)} tiles")

    for tile in tiles:
        lon0, lat0 = tile_origin(tile)
        west, south, east, north = lon0, lat0, lon0 + 1, lat0 + 1
        arr = np.fromfile(os.path.join(args.cache, f"{tile}.hgt"), dtype=">i2").reshape(HGT_SIDE, HGT_SIDE).astype("float32")
        arr[arr <= VOID] = np.nan
        res = 1.0 / 3600.0
        transform = rasterio.transform.from_origin(west, north, res, res)

        lat_mid = lat0 + 0.5
        dy = res * DEG_M_LAT
        dx = res * DEG_M_LON * math.cos(math.radians(lat_mid))
        gy, gx = np.gradient(arr, dy, dx)
        slope = np.degrees(np.arctan(np.hypot(gx, gy)))

        here = [(uid, geom) for uid, geom, bb in units
                if bb[0] < east and bb[2] > west and bb[1] < north and bb[3] > south]
        if not here:
            continue
        shapes = [(geom, index[uid]) for uid, geom in here]
        zones = rasterize(shapes, out_shape=(HGT_SIDE, HGT_SIDE), transform=transform, fill=0, dtype="int32")
        valid = (zones > 0) & np.isfinite(arr)
        if not valid.any():
            continue
        z = zones[valid]
        e = arr[valid]
        s = slope[valid]

        cnt += np.bincount(z, minlength=n)
        elev_sum += np.bincount(z, weights=e, minlength=n)
        slope_sum += np.bincount(z, weights=s, minlength=n)
        np.minimum.at(elev_min, z, e)
        np.maximum.at(elev_max, z, e)
        np.maximum.at(slope_max, z, s)
        for bi, (lo, hi) in enumerate(SLOPE_BANDS):
            sel = (s >= lo) & (s < hi)
            band_counts[bi] += np.bincount(z[sel], minlength=n)
        print(f"  {tile}: {len(here)} units, {int(valid.sum()):,} valid px", flush=True)

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    elev_latest, slope_latest, written = {}, {}, 0
    for uid, _, _ in units:
        i = index[uid]
        if cnt[i] == 0:
            continue
        written += 1
        bands = {lab: round(float(band_counts[bi][i]) / cnt[i], 4) for bi, lab in enumerate(SLOPE_LABELS)}
        elev_latest[uid] = round(float(elev_sum[i] / cnt[i]), 1)
        slope_latest[uid] = round(float(slope_sum[i] / cnt[i]), 2)
        dump_json(os.path.join(out, "static", f"{uid}.json"), {
            "unit_id": uid, "source_id": "srtm", "product_version": SRTM_VERSION, "resolution_m": 30,
            "elevation_m": {"mean": round(float(elev_sum[i] / cnt[i]), 1),
                            "min": round(float(elev_min[i]), 1), "max": round(float(elev_max[i]), 1)},
            "slope_deg": {"mean": round(float(slope_sum[i] / cnt[i]), 2), "max": round(float(slope_max[i]), 2)},
            "slope_class_share": bands, "valid_pixels": int(cnt[i]),
            "aggregation": "zonal mean over valid SRTM pixels inside the polygon",
            "generated_at": generated_at})

    update_meta(os.path.join(out, "meta.json"), generated_at)
    add_props(os.path.join(out, "districts.geojson"), elev_latest, slope_latest)
    for path in glob.glob(os.path.join(out, "ucs", "*.geojson")):
        add_props(path, elev_latest, slope_latest)
    print(f"wrote static terrain for {written}/{len(units)} units")


def update_meta(meta_path, generated_at):
    if not os.path.exists(meta_path):
        return
    meta = load_json(meta_path)
    meta.setdefault("sources", {})["srtm"] = {
        "name": "SRTMGL1 elevation (NASA/USGS), 1 arc-second",
        "dataset": "AWS elevation-tiles skadi store (SRTMGL1)", "status": "live",
        "licence": "Public domain (NASA/USGS)"}
    inds = {i["id"]: i for i in meta.get("indicators", [])}
    for iid, name, unit in (("elev_m", "Mean elevation", "m"), ("slope_deg", "Mean slope", "deg")):
        inds[iid] = {"id": iid, "name_en": name, "unit": unit, "period": "static", "category": "terrain",
                     "aggregation": "mean", "params": {}, "source_id": "srtm",
                     "product_version": SRTM_VERSION, "resolution_m": 30, "documentation": "docs/indicators.md"}
    meta["indicators"] = list(inds.values())
    meta["contract_version"] = "0.3"
    dump_json(meta_path, meta)


def add_props(path, elev, slope):
    if not os.path.exists(path):
        return
    fc = load_json(path)
    for f in fc["features"]:
        p = f["properties"]
        uid = p.get("uc_id") or p.get("district_id")
        p["elev_m"] = elev.get(uid)
        p["slope_deg"] = slope.get(uid)
    dump_json(path, fc, compact=True)


if __name__ == "__main__":
    main()
