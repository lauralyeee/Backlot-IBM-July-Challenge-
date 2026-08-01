# NOTICE

Backlot is licensed under the MIT License (see `LICENSE`), copyright Laura Lai
Jia Ying and Henry Khoo Shien Chen. This file documents everything the MIT
grant does *not* cover: third-party open-source components, external AI
services, trademarks, and the terms of the competition this project was
built for.

## 1. Third-party open-source components

Backlot depends on the following open-source packages, each under its own
license. Their license texts are preserved in `node_modules/` and the Python
virtual environment as installed; this table is a summary, not a substitute.

### Frontend (npm)

| Package | License |
|---|---|
| react | MIT |
| react-dom | MIT |
| @google/model-viewer | Apache-2.0 |
| vite | MIT |
| @vitejs/plugin-react | MIT |

### Backend (Python)

| Package | License |
|---|---|
| fastapi | MIT |
| uvicorn | BSD-3-Clause |
| httpx | BSD-3-Clause |
| python-dotenv | BSD-3-Clause |
| python-multipart | Apache-2.0 |
| libsql | MIT |
| vercel_blob | MIT (per publisher; not independently verified — confirm before public release) |
| reportlab | BSD (ReportLab license) |
| python-docx | MIT |
| docling | MIT (local dev only; not included in the Vercel deployment bundle) |

None of these licenses require Backlot itself to be relicensed. Apache-2.0
and BSD components additionally require their own copyright/attribution
notices to travel with redistributed copies — this file serves that purpose.

## 2. External AI services (not bundled, not covered by MIT)

Backlot calls out to the following third-party AI services and tools at
runtime. They are not distributed as part of this repository, and content
they generate or process is governed by their own terms, not by the MIT
License above:

- **IBM Granite via watsonx.ai** — canon text generation and reasoning.
- **IBM Docling** — document parsing (PDF/DOCX to text), run locally as a
  Python dependency or remotely via a hosted docling-serve instance.
- **Google Gemini TTS** — voice casting.
- **Pollinations.ai (Flux)** — portrait generation.
- **Blender + CharMorph** — invoked headlessly, out-of-process, as external
  tools to produce 3D models. Blender is GPL-licensed and CharMorph is a
  GPL-licensed Blender add-on; Backlot does not link against either and
  treats them as external programs invoked via subprocess, so the GPL does
  not extend to Backlot's own source. The `.glb` files they output are
  data, not derivative code.

If you redistribute Backlot or its outputs, check the current terms of each
service above — particularly around commercial use, attribution, and
ownership of generated content (text, portraits, voice audio, 3D models).

## 3. Trademarks

"IBM," "Granite," "watsonx," "Docling," "Google," and "Gemini" are
trademarks of their respective owners. Their use in this project's
documentation is descriptive (to identify the services used) and does not
imply endorsement, sponsorship, or affiliation. "Backlot" refers to this
project's own name and is not a claimed registered trademark.

## 4. Competition submission

This project was built by Laura Lai Jia Ying and Henry Khoo Shien Chen for
the IBM AI Builders Challenge, July 2026 (Creative Industries theme). The
MIT License above governs how *other developers* may reuse this code; it
does not override any separate submission terms, IP grants, or usage rights
the challenge's official rules require from participants. Consult those
rules directly for anything related to the competition submission itself.
