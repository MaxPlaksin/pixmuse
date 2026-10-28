#!/usr/bin/env python3
"""Разбор PSB/PSD: дерево слоёв и параметры adjustment layers."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from psd_tools import PSDImage
from psd_tools.api.layers import AdjustmentLayer, Group
from psd_tools.constants import Tag


def mask_info(layer) -> dict | None:
    m = getattr(layer, "mask", None)
    if m is None:
        return None
    return {
        "disabled": getattr(m, "disabled", None),
        "background_color": getattr(m, "background_color", None),
    }


def adjustment_payload(layer: AdjustmentLayer) -> dict:
    out: dict = {
        "name": layer.name,
        "kind": layer.kind,
        "opacity": layer.opacity,
        "blend": str(layer.blend_mode),
        "visible": layer.visible,
        "mask": mask_info(layer),
    }
    tb = layer.tagged_blocks
    if Tag.CURVES in tb:
        c = tb.get_data(Tag.CURVES)
        out["curves"] = {"data": c.data, "version": c.version}
    if Tag.HUE_SATURATION in tb:
        h = tb.get_data(Tag.HUE_SATURATION)
        out["hue_saturation"] = {
            "master": h.master,
            "colorization": h.colorization,
            "enable": h.enable,
            "items": h.items,
        }
    if Tag.SELECTIVE_COLOR in tb:
        s = tb.get_data(Tag.SELECTIVE_COLOR)
        out["selective_color"] = {"method": s.method, "data": s.data}
    return out


def walk(layer, depth: int = 0) -> list[dict]:
    rows: list[dict] = []
    if isinstance(layer, Group):
        node = {
            "type": "group",
            "name": layer.name,
            "opacity": layer.opacity,
            "blend": str(layer.blend_mode),
            "mask": mask_info(layer),
            "children": [],
        }
        for ch in layer:
            child_rows = walk(ch, depth + 1)
            if len(child_rows) == 1 and child_rows[0].get("type") != "group":
                node["children"].append(child_rows[0])
            else:
                node["children"].extend(child_rows)
        rows.append(node)
    elif isinstance(layer, AdjustmentLayer):
        rows.append({"type": "adjustment", **adjustment_payload(layer)})
    else:
        rows.append(
            {
                "type": type(layer).__name__,
                "name": layer.name,
                "opacity": layer.opacity,
                "blend": str(layer.blend_mode),
                "mask": mask_info(layer),
            }
        )
    return rows


def analyze(path: Path) -> dict:
    psd = PSDImage.open(path)
    tree = []
    for top in psd:
        tree.extend(walk(top))
    return {
        "file": path.name,
        "width": psd.width,
        "height": psd.height,
        "depth": psd.depth,
        "color_mode": psd.color_mode,
        "layers": tree,
    }


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    targets = sorted(root.glob("*.psb"))
    if len(sys.argv) > 1:
        targets = [Path(p) for p in sys.argv[1:]]
    for p in targets:
        print(json.dumps(analyze(p), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
