---
title: Backlot Docling Serve
emoji: 📄
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
---

# Backlot Docling Serve

Hosts [IBM Docling](https://github.com/docling-project/docling) as an HTTP API
([docling-serve](https://github.com/docling-project/docling-serve)), for
Backlot's PDF/DOCX import feature (Import screen). Backlot's Vercel-hosted
backend can't run Docling in-process — its dependency stack
(torch/transformers/onnxruntime) is too large for a Vercel Python function's
500 MB bundle limit, regardless of file size. This Space runs it separately;
`backend/ingestion.py` calls it over HTTP when `DOCLING_SERVE_URL` is set.

## Deploying this Space

1. Create a new Space on huggingface.co: **Docker** SDK, free **CPU basic**
   hardware is enough for occasional small-file conversion.
2. Push this folder's contents (`Dockerfile` + this `README.md`) to the
   Space's git repo, or upload them through the Space's **Files** tab.
3. Wait for the build to finish (~5–10 minutes the first time — it's pulling
   a multi-GB image with Docling's model weights).
4. Note the Space's URL, e.g. `https://<username>-backlot-docling-serve.hf.space`.
5. Optional: add a `DOCLING_SERVE_API_KEY` repository secret in the Space's
   **Settings** to require an API key on requests (recommended if the Space
   is public — otherwise anyone who finds the URL can use your compute).

## Wiring it into Backlot

In Vercel's project environment variables, set:

- `DOCLING_SERVE_URL` = the Space URL from step 4 above
- `DOCLING_SERVE_API_KEY` = the same value as the Space secret, if you set one

Redeploy. `/api/capabilities` will report `doclingImport: true` once
`DOCLING_SERVE_URL` is present in the environment.

## Notes

- Free-tier Spaces sleep after inactivity — the first request after a while
  can take 30–60+ seconds while it wakes up and loads models. Worth doing a
  warm-up request before a live demo.
- This Space has no relationship to Backlot's Turso database or Vercel Blob
  stores — it only converts documents to markdown and returns text. Nothing
  is persisted here.
