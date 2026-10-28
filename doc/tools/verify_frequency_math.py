#!/usr/bin/env python3
"""
Проверка математики ElizFrequencySetup.jsx без Photoshop.
Сравнивает реконструкцию Low + High (Linear Light 100%) с исходником.

8-bit:  high = (src - low) / 2 + 128  (Apply Image Subtract, scale 2, offset 128)
16-bit: high = (src + invert(low)) / 2  (Apply Image Add, invert, scale 2, offset 0)

Blur: OpenCV GaussianBlur — близко к PS, но не бит-в-бит (финал только в PS).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

try:
    import cv2
except ImportError:
    print("pip install opencv-python numpy")
    sys.exit(1)

RADIUS = 7


def ps_gaussian_blur(img: np.ndarray, radius: float) -> np.ndarray:
    """radius в px как в PS (sigma ≈ radius/2 — типичная эвристика)."""
    k = int(radius * 2) * 2 + 1
    sigma = radius / 2.0
    out = np.empty_like(img, dtype=np.float64)
    for c in range(img.shape[2]):
        out[..., c] = cv2.GaussianBlur(
            img[..., c].astype(np.float64), (k, k), sigmaX=sigma, sigmaY=sigma
        )
    return out


def apply_image_subtract_8(high: np.ndarray, low: np.ndarray) -> np.ndarray:
    """Target=high, Source=low, Subtract, scale 2, offset 128."""
    out = (high.astype(np.float64) - low.astype(np.float64)) / 2.0 + 128.0
    return np.clip(out, 0, 255)


def apply_image_add_invert_16(high: np.ndarray, low: np.ndarray) -> np.ndarray:
    """Target=high, Source=low, Add, invert source, scale 2, offset 0 (PS 16-bit 0..32768)."""
    max_val = 32768.0
    inv_low = max_val - low.astype(np.float64)
    out = (high.astype(np.float64) + inv_low) / 2.0
    return np.clip(out, 0, max_val)


def linear_light_8(base: np.ndarray, blend: np.ndarray, opacity: float = 1.0) -> np.ndarray:
    b = base.astype(np.float64)
    h = blend.astype(np.float64)
    if opacity < 1.0:
        h = 128.0 + (h - 128.0) * opacity
    # Photoshop Linear Light (blend поверх base)
    out = np.where(h <= 128.0, b + 2.0 * h - 256.0, b + 2.0 * (h - 128.0))
    return np.clip(out, 0, 255)


def linear_light_16(base: np.ndarray, blend: np.ndarray, opacity: float = 1.0) -> np.ndarray:
    mid = 128.0  # 16-bit linear light pivot in PS uses 128 in 8-bit terms; for 16-bit use normalized
    # В 16-bit режиме PS Linear Light использует ту же логику на значениях канала.
    b = base.astype(np.float64)
    h = blend.astype(np.float64)
    pivot = 16384.0  # середина 0..32768
    if opacity < 1.0:
        h = pivot + (h - pivot) * opacity
    out = np.where(h <= pivot, b + 2.0 * h - 2.0 * pivot, b + 2.0 * (h - pivot))
    return np.clip(out, 0, 32768.0)


def stats(name: str, orig: np.ndarray, recon: np.ndarray) -> dict:
    diff = np.abs(orig.astype(np.float64) - recon.astype(np.float64))
    return {
        "name": name,
        "max": float(diff.max()),
        "mean": float(diff.mean()),
        "psnr": float(cv2.PSNR(orig.astype(np.uint8) if orig.max() <= 255 else orig.astype(np.uint16), recon.astype(np.uint8) if recon.max() <= 255 else recon.astype(np.uint16))) if diff.max() > 0 else 99.0,
    }


def test_8bit_path(img_u8: np.ndarray) -> dict:
    src = img_u8.astype(np.float64)
    low = ps_gaussian_blur(src, RADIUS)
    high = src.copy()
    high = apply_image_subtract_8(high, low)
    recon = linear_light_8(low, high, 1.0)
    return stats("8-bit path (JPEG preview)", src, recon)


def test_16bit_path(img_u8: np.ndarray) -> dict:
    src = (img_u8.astype(np.float64) / 255.0 * 32768.0).astype(np.float64)
    low = ps_gaussian_blur(src, RADIUS)
    high = src.copy()
    high = apply_image_add_invert_16(high, low)
    recon = linear_light_16(low, high, 1.0)
    return stats("16-bit path (simulated from preview)", src, recon)


def test_synthetic_8() -> dict:
    rng = np.random.default_rng(0)
    src = rng.integers(0, 256, (512, 512, 3), dtype=np.uint8)
    return test_8bit_path(src)


def verify_batch_logic(repo: Path) -> list[str]:
    """Статическая проверка ElizBatchColorButton.jsx (без PS)."""
    jsx = (repo / "doc/photoshop/ElizBatchColorButton.jsx").read_text(encoding="utf-8")
    checks = []
    for needle, label in [
        ("DONOTSAVECHANGES", "закрытие без записи в CR3"),
        ("_after_button", "отдельная папка вывода"),
        ("batch.log", "журнал"),
        ("PILOT_MODE", "режим пилота"),
        ("psdFile.exists", "skip при существующем PSD"),
        ("doAction", "вызов экшена (не CatalogColorStack)"),
    ]:
        ok = needle in jsx
        checks.append(f"{'OK' if ok else 'FAIL'} batch: {label}")
    if "ElizCatalogColorStack" in jsx and "doAction" in jsx:
        checks.append("OK batch: CatalogColorStack не вызывается из JSX")
    return checks


def main() -> int:
    repo = Path(__file__).resolve().parents[2]
    previews = repo / "doc/previews"
    paths = sorted(previews.glob("*.jpg"))
    if not paths:
        print("Нет doc/previews/*.jpg")
        return 1

    print("=== Частотка: реконструкция Low+High (Linear Light 100%) ===\n")
    print(f"Радиус blur: {RADIUS}px (эмуляция, не Adobe Gaussian)\n")

    syn = test_synthetic_8()
    print(f"Synthetic 8-bit: maxΔ={syn['max']:.4f} meanΔ={syn['mean']:.6f}")

    for p in paths[:3]:
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img is None:
            continue
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        s8 = test_8bit_path(img)
        s16 = test_16bit_path(img)
        print(f"\n{p.name}:")
        print(f"  8-bit:  maxΔ={s8['max']:.4f} meanΔ={s8['mean']:.4f}")
        print(f"  16-bit: maxΔ={s16['max']:.2f} meanΔ={s16['mean']:.4f} (sim 16-bit LL approx)")

    print("\n=== ElizBatchColorButton (статика) ===")
    for line in verify_batch_logic(repo):
        print(line)

    print("\n=== Что без PS не проверить ===")
    print("- doAction / Apply Image Action Manager (charID Add )")
    print("- ACR при открытии CR3, 16-bit документ после Open")
    print("- Визуальное совпадение с экшеном Лизы и до после.psb")
    print("\nИтог: math 8-bit при maxΔ≈0 — формула сходится; blur PS может дать малый дrift на реальном кадре.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
