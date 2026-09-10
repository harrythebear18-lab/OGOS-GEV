#!/usr/bin/env python3
"""
CLIP Embedding Server — open_clip FastAPI for the OSINT Sentinel Workstation.
Run: python clip_server.py
Requires: pip install open_clip_torch torch fastapi uvicorn pillow
"""

import base64
import io
import os
import sys
from typing import Optional

try:
    import open_clip
    import torch
    from fastapi import FastAPI, HTTPException
    from pydantic import BaseModel
    import uvicorn
    from PIL import Image
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install open_clip_torch torch fastapi uvicorn pillow")
    sys.exit(1)

# ── Model ──
MODEL_NAME = os.environ.get("CLIP_MODEL", "ViT-B-32")
PRETRAINED = os.environ.get("CLIP_PRETRAINED", "openai")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

print(f"[clip] Loading {MODEL_NAME} ({PRETRAINED}) on {DEVICE}...")
model, _, preprocess = open_clip.create_model_and_transforms(
    MODEL_NAME, pretrained=PRETRAINED, device=DEVICE
)
tokenizer = open_clip.get_tokenizer(MODEL_NAME)
print(f"[clip] {MODEL_NAME} loaded — ready on :9776")

# ── API ──
app = FastAPI(title="CLIP Embedding Server")

class TextRequest(BaseModel):
    text: str

class ImageRequest(BaseModel):
    image_path: Optional[str] = None
    image_base64: Optional[str] = None

class SimilarityRequest(BaseModel):
    a: list
    b: list

@app.get("/health")
def health():
    return {"running": True, "model": f"{MODEL_NAME}/{PRETRAINED}", "device": DEVICE}

@app.post("/embed/text")
def embed_text(req: TextRequest):
    tokens = tokenizer(req.text).to(DEVICE)
    with torch.no_grad():
        embedding = model.encode_text(tokens).cpu().numpy()[0].tolist()
    return {"embedding": embedding}

@app.post("/embed/image")
def embed_image(req: ImageRequest):
    if req.image_path:
        image = Image.open(req.image_path).convert("RGB")
    elif req.image_base64:
        image_data = base64.b64decode(req.image_base64)
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
    else:
        raise HTTPException(400, "Provide image_path or image_base64")

    image_tensor = preprocess(image).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        embedding = model.encode_image(image_tensor).cpu().numpy()[0].tolist()
    return {"embedding": embedding}

@app.post("/similarity")
def compute_similarity(req: SimilarityRequest):
    a = torch.tensor(req.a, device=DEVICE)
    b = torch.tensor(req.b, device=DEVICE)
    sim = torch.cosine_similarity(a.unsqueeze(0), b.unsqueeze(0)).item()
    return {"similarity": sim}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9776, log_level="info")
