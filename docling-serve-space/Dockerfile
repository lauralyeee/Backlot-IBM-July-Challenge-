# Standalone docling-serve deployment for Hugging Face Spaces (Docker SDK).
# This is what backend/ingestion.py's DOCLING_SERVE_URL points at -- Docling's
# own dependency stack (torch/transformers/onnxruntime) is too large to run
# inside a Vercel Python function, so it runs here instead and the backend
# calls it over HTTP. See ../backend/.env.example.
#
# HF Spaces' free Docker tier expects the container to listen on port 7860.
FROM ghcr.io/docling-project/docling-serve-cpu:latest

ENV UVICORN_PORT=7860
# Demo UI at /ui -- handy for testing the Space directly in a browser
# without going through Backlot at all. Safe to leave on.
ENV DOCLING_SERVE_ENABLE_UI=1

EXPOSE 7860
