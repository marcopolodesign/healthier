#!/usr/bin/env python3
"""Generate landing images via Gemini image API (nano banana).

Reads GEMINI_API_KEY from the environment (source ~/Local/.env).

Usage: python3 gen-landing-image.py <output.jpg> "<prompt>"
"""
import base64
import json
import os
import sys
import urllib.request

# Consistent style block — see docs/image-style-guide.md before changing
STYLE = (
    " Photographed in the style of a hims & hers brand campaign: soft diffused "
    "studio lighting from a large softbox, matte low-contrast color grade, slightly "
    "desaturated, natural skin texture, candid relaxed mid-gesture expression (never "
    "a stiff corporate pose), solid muted wardrobe with no patterns or logos, "
    "editorial healthcare campaign photography, no text, no watermark, no logos."
)

MODELS = ["gemini-2.5-flash-image", "gemini-2.0-flash-exp"]


def get_key():
    return os.environ["GEMINI_API_KEY"]


def generate(key, model, prompt):
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]},
    }).encode()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=body,
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.load(r)
    for part in resp["candidates"][0]["content"]["parts"]:
        if "inlineData" in part:
            return base64.b64decode(part["inlineData"]["data"])
    raise RuntimeError("no image in response")


def main():
    out, prompt = sys.argv[1], sys.argv[2] + STYLE
    key = get_key()
    last_err = None
    for model in MODELS:
        try:
            data = generate(key, model, prompt)
            with open(out, "wb") as f:
                f.write(data)
            print(f"OK {out} ({len(data)//1024} KB, {model})")
            return
        except Exception as e:  # noqa: BLE001 — try next model
            last_err = e
    raise SystemExit(f"all models failed: {last_err}")


if __name__ == "__main__":
    main()
