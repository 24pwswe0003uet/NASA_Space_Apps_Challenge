#!/usr/bin/env python3
"""Download the SRTM 1-arc-second elevation tiles that cover the KP units, no key.

The tiles are NASA/USGS SRTMGL1, published keylessly as gzipped .hgt files on the
Mapzen/AWS elevation-tiles bucket (the "skadi" store). Each tile is a 3601x3601
grid of big-endian int16 metres, covering one degree by one degree. Only the tiles
that intersect an administrative unit are fetched, and each is decompressed to
cache/srtm/<tile>.hgt.

    python3 pipeline/fetch_srtm.py [--boundaries cache/boundaries] [--cache cache/srtm]

Consumed by terrain_stats.py. No credentials; NASA/USGS data is public domain.
"""
import argparse
import glob
import gzip
import json
import math
import os
import sys
import time

import requests

from geo import bbox

HERE = os.path.dirname(os.path.abspath(__file__))
URL = "https://elevation-tiles-prod.s3.amazonaws.com/skadi/{ns}/{tile}.hgt.gz"
HGT_SIDE = 3601  # SRTMGL1: 1 arc-second samples, 3601 per degree


def tile_name(lat, lon):
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"{ns}{abs(lat):02d}{ew}{abs(lon):03d}"


def load_unit_boxes(bnd_dir):
    boxes = []
    for path in [os.path.join(bnd_dir, "districts.geojson")] + sorted(glob.glob(os.path.join(bnd_dir, "ucs", "*.geojson"))):
        if os.path.basename(path) == "all.geojson" or not os.path.exists(path):
            continue
        for f in json.load(open(path, encoding="utf-8"))["features"]:
            boxes.append(bbox(f["geometry"]))
    return boxes


def needed_tiles(boxes):
    tiles = set()
    for minx, miny, maxx, maxy in boxes:
        la = math.floor(miny)
        while la <= math.floor(maxy):
            lo = math.floor(minx)
            while lo <= math.floor(maxx):
                tiles.add(tile_name(la, lo))
                lo += 1
            la += 1
    return sorted(tiles)


def fetch_tile(tile, cache, retries=4):
    out = os.path.join(cache, f"{tile}.hgt")
    if os.path.exists(out) and os.path.getsize(out) == HGT_SIDE * HGT_SIDE * 2:
        return "cached"
    ns = tile[:3]
    url = URL.format(ns=ns, tile=tile)
    delay = 2
    for attempt in range(retries):
        try:
            r = requests.get(url, timeout=300, stream=True)
            if r.status_code == 404:
                return "missing"
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(str(r.status_code))
            r.raise_for_status()
            raw = b"".join(r.iter_content(1 << 20))
            data = gzip.decompress(raw)
            if len(data) != HGT_SIDE * HGT_SIDE * 2:
                raise ValueError(f"unexpected size {len(data)}")
            with open(out, "wb") as fh:
                fh.write(data)
            return f"{len(data) / 1e6:.1f} MB"
        except Exception as exc:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            print(f"  {tile}: retry {attempt + 1} after {exc}", file=sys.stderr)
            time.sleep(delay)
            delay *= 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boundaries", default=os.path.join(HERE, "cache", "boundaries"))
    ap.add_argument("--cache", default=os.path.join(HERE, "cache", "srtm"))
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    boxes = load_unit_boxes(args.boundaries)
    if not boxes:
        sys.exit("no boundaries found; run prepare_boundaries.py first")
    tiles = needed_tiles(boxes)
    print(f"{len(boxes)} units -> {len(tiles)} SRTM tiles: {tiles}", flush=True)

    done = failed = 0
    for i, tile in enumerate(tiles, 1):
        try:
            status = fetch_tile(tile, args.cache)
            done += 1
            print(f"[{i}/{len(tiles)}] {tile}: {status}", flush=True)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"[{i}/{len(tiles)}] {tile} FAILED: {exc}", file=sys.stderr, flush=True)
    print(f"SRTM done: {done} tiles, {failed} failed -> {args.cache}")
    sys.exit(1 if failed and not done else 0)


if __name__ == "__main__":
    main()
