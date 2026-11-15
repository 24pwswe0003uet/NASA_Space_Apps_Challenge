#!/usr/bin/env python3
"""Derived agro-climate indicators from the NASA POWER cache, no new downloads.

Reuses the daily POWER records that fetch_power.py already wrote (temperature,
humidity, wind, radiation, pressure) to compute per-dekad indicators per unit:

    frost_days   count of days with T2M_MIN below the frost threshold
    gdd          sum of max(Tmean - base, 0)          (degree-days)
    t_mean       mean of (T2M_MAX + T2M_MIN) / 2      (degC)

Nothing is invented: a dekad whose POWER record is missing, or that has more
than `max_missing` days without data, is written as null rather than filled.

    python3 pipeline/power_indicators.py [--out ../data] [--cache cache/power]

Outputs (additive to the v0.2 contract, which is left untouched):
    data/indicators/<indicator_id>/<unit_id>.json   dekadal series per unit
    data/meta.json                                  adds sources.nasa_power + indicators[]
    data/districts.geojson, data/ucs/*.geojson      adds latest value per indicator

The indicator definitions (units, method, parameters) live in pipeline/indicators.json.
"""
import argparse
import glob
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.abspath(os.path.join(HERE, "..", "data"))
DEFAULT_CACHE = os.path.join(HERE, "cache", "power")
DEFS = os.path.join(HERE, "indicators.json")
MAX_MISSING = 2  # a dekad may lose at most this many days and still be reported


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


def day_range(start, end):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


# ----------------------------------------------------------------- indicator maths
def compute(indicator, params, daily, start, end):
    """Return (value, valid_days, quality) for one indicator on one dekad."""
    tmax = daily.get("T2M_MAX", {})
    tmin = daily.get("T2M_MIN", {})
    days = list(day_range(start, end))
    tmins, tmeans = [], []
    for d in days:
        key = d.strftime("%Y%m%d")
        lo = tmin.get(key)
        hi = tmax.get(key)
        if lo is not None and lo < -900:
            lo = None
        if hi is not None and hi < -900:
            hi = None
        if lo is not None:
            tmins.append(lo)
        if lo is not None and hi is not None:
            tmeans.append((hi + lo) / 2.0)

    if indicator == "frost_days":
        valid = tmins
        if len(days) - len(valid) > MAX_MISSING:
            return None, len(valid), "insufficient_days"
        thr = float(params.get("frost_threshold_c", 0.0))
        return int(sum(1 for t in valid if t < thr)), len(valid), "ok"

    if indicator == "gdd":
        valid = tmeans
        if len(days) - len(valid) > MAX_MISSING:
            return None, len(valid), "insufficient_days"
        base = float(params.get("base_temp_c", 10.0))
        return round(sum(max(t - base, 0.0) for t in valid), 1), len(valid), "ok"

    if indicator == "t_mean":
        valid = tmeans
        if len(days) - len(valid) > MAX_MISSING:
            return None, len(valid), "insufficient_days"
        return round(sum(valid) / len(valid), 1), len(valid), "ok"

    raise ValueError(f"unknown indicator {indicator}")


# ----------------------------------------------------------------- units
def load_units(bnd_dir):
    units = []
    dpath = os.path.join(bnd_dir, "districts.geojson")
    if not os.path.exists(dpath):
        sys.exit(f"missing {dpath}; run prepare_boundaries.py first")
    for f in load_json(dpath)["features"]:
        units.append(f["properties"]["district_id"])
    for path in sorted(glob.glob(os.path.join(bnd_dir, "ucs", "*.geojson"))):
        if os.path.basename(path) == "all.geojson":
            continue
        for f in load_json(path)["features"]:
            units.append(f["properties"]["uc_id"])
    return units


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--cache", default=DEFAULT_CACHE)
    ap.add_argument("--boundaries", default=os.path.join(HERE, "cache", "boundaries"))
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    meta_path = os.path.join(out, "meta.json")
    if not os.path.exists(meta_path):
        sys.exit(f"missing {meta_path}; run build_series.py first")
    meta = load_json(meta_path)
    dekads = [(date.fromisoformat(d["start"]), date.fromisoformat(d["end"])) for d in meta["dekads"]]

    defs = load_json(DEFS)
    power_defs = {k: v for k, v in defs.items() if not k.startswith("_") and v.get("source_id") == "nasa_power"}

    units = load_units(args.boundaries)
    print(f"{len(units)} units, {len(dekads)} dekads, indicators {sorted(power_defs)}")

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    latest = {k: {} for k in power_defs}   # indicator -> unit -> latest value
    covered = {k: 0 for k in power_defs}

    for unit in units:
        rec_path = os.path.join(args.cache, f"{unit}.json")
        if not os.path.exists(rec_path):
            continue
        daily = load_json(rec_path).get("daily", {})
        for ind, d in power_defs.items():
            rows = []
            for start, end in dekads:
                value, valid_days, quality = compute(ind, d.get("params", {}), daily, start, end)
                rows.append({"start": start.isoformat(), "end": end.isoformat(),
                             "value": value, "valid_days": valid_days, "quality": quality})
            if all(r["value"] is None for r in rows):
                continue
            covered[ind] += 1
            latest[ind][unit] = rows[-1]["value"]
            dump_json(os.path.join(out, "indicators", ind, f"{unit}.json"), {
                "unit_id": unit, "indicator": ind, "name_en": d["name_en"], "unit": d["unit"],
                "period": d["period"], "aggregation": d["aggregation"], "params": d.get("params", {}),
                "source_id": d["source_id"], "product_version": d["product_version"],
                "dekads": rows, "generated_at": generated_at})

    # ---- augment the v0.2 outputs additively -----------------------------------
    meta.setdefault("sources", {})["nasa_power"] = {
        "name": "NASA POWER daily agroclimatology (temperature, humidity, wind, radiation, pressure)",
        "dataset": "power.larc.nasa.gov temporal/daily/point, community AG",
        "status": "live", "licence": "Public domain (NASA)"}
    meta["indicators"] = [
        {"id": ind, "name_en": d["name_en"], "unit": d["unit"], "period": d["period"],
         "category": d["category"], "aggregation": d["aggregation"], "params": d.get("params", {}),
         "source_id": d["source_id"], "product_version": d["product_version"],
         "resolution_m": d["resolution_m"], "documentation": d["documentation"]}
        for ind, d in power_defs.items()]
    meta["contract_version"] = "0.3"
    dump_json(meta_path, meta)

    add_latest_to_geojson(os.path.join(out, "districts.geojson"), latest)
    for path in glob.glob(os.path.join(out, "ucs", "*.geojson")):
        add_latest_to_geojson(path, latest)

    print("wrote indicators: " + ", ".join(f"{k} ({covered[k]} units)" for k in sorted(power_defs)))


def add_latest_to_geojson(path, latest):
    if not os.path.exists(path):
        return
    fc = load_json(path)
    for f in fc["features"]:
        props = f["properties"]
        uid = props.get("uc_id") or props.get("district_id")
        for ind, values in latest.items():
            props[ind] = values.get(uid)
    dump_json(path, fc, compact=True)


if __name__ == "__main__":
    main()
