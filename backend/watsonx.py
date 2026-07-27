"""
watsonx.ai / IBM Granite client — server-side.

Credentials (WATSONX_API_KEY, WATSONX_PROJECT_ID) live only here;
the browser never sees them.  The frontend calls /api/generate,
/api/ping, /api/models — this module handles the actual IBM calls.

NOTE (2026-07-26): switched from the raw completion endpoint
(/ml/v1/text/generation) to the chat-completions endpoint
(/ml/v1/text/chat). The completion endpoint requires the caller to
hand-format Granite's chat template (<|start_of_role|>...<|end_of_text|>)
and had no reliable stop signal, which is why replies were sometimes
running on past the answer and echoing instruction-like text back at
the user. /text/chat takes structured {role, content} messages and lets
watsonx.ai apply each model's own chat template + stop handling, which
is IBM's documented way to drive instruct/chat models.
"""

import os
import asyncio
import httpx
from dotenv import load_dotenv

load_dotenv()

WATSONX_API_KEY = os.environ.get("WATSONX_API_KEY", "")
WATSONX_PROJECT_ID = os.environ.get("WATSONX_PROJECT_ID", "")
IAM_URL = "https://iam.cloud.ibm.com/identity/token"
WX_BASE = "https://eu-de.ml.cloud.ibm.com"

# Keep in sync with src/lib/watsonx.js MODEL_CHAIN.
# Primary is IBM Granite (this project's core LLM). The fallback used to be
# "ibm/granite-3-3-8b-instruct", but a live GET /api/models check on
# 2026-07-26 showed it is NOT reachable on this watsonx.ai project/region
# (eu-de) -- it silently failed on every retry. Replaced with
# "mistralai/mistral-medium-2505": confirmed live on this account, and the
# strongest available fallback by intelligence/latency/cost among the
# account's other reachable models (Llama 3.3 70B Instruct, Llama 4
# Maverick, Mistral Small 3.1). If IBM deprecates a model or account access
# changes, use /api/models to find current live IDs.
MODEL_CHAIN = ["ibm/granite-4-h-small", "mistralai/mistral-medium-2505"]

_token_cache: dict = {"token": None, "expires_at": 0.0}


async def _get_token(client: httpx.AsyncClient) -> str:
    import time
    if _token_cache["token"] and time.time() < _token_cache["expires_at"]:
        return _token_cache["token"]

    resp = await client.post(
        IAM_URL,
        data={
            "grant_type": "urn:ibm:params:oauth:grant-type:apikey",
            "apikey": WATSONX_API_KEY,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError("IAM token exchange failed: no access_token in response")
    # IBM tokens last ~3600 s; refresh with 60 s headroom
    import time as _t
    _token_cache["token"] = token
    _token_cache["expires_at"] = _t.time() + float(data.get("expires_in", 3600)) - 60
    return token


def _msg(role: str, text: str) -> dict:
    """Build a /text/chat message. User content is an array of text parts
    per watsonx.ai's chat schema; system/assistant content is a plain
    string."""
    if role == "user":
        return {"role": "user", "content": [{"type": "text", "text": text}]}
    return {"role": role, "content": text}


def chat_message(role: str, text: str) -> dict:
    """Public alias of _msg() for callers (e.g. main.py) building multi-turn
    message lists directly, such as character-chat history."""
    return _msg(role, text)


def _extract_reply(data: dict) -> str:
    choices = data.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return content or ""


async def _call_chat(
    client: httpx.AsyncClient, model: str, messages: list[dict], max_tokens: int
) -> str:
    token = await _get_token(client)
    resp = await client.post(
        f"{WX_BASE}/ml/v1/text/chat?version=2024-05-31",
        json={
            "model_id": model,
            "project_id": WATSONX_PROJECT_ID,
            "messages": messages,
            "parameters": {
                "max_new_tokens": max_tokens,
                "time_limit": 30000,
            },
        },
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        timeout=60,
    )
    data = resp.json()
    if not resp.is_success or data.get("errors"):
        msg = (data.get("errors") or [{}])[0].get("message", f"status {resp.status_code}")
        raise RuntimeError(msg)
    text = _extract_reply(data)
    if not text.strip():
        raise RuntimeError("empty response from model")
    return text


_last_good_model: str | None = None


async def generate_messages(messages: list[dict], max_tokens: int = 1000) -> str:
    """Call the model chain with fallback, chat-endpoint version.

    messages must already be in {role, content} form — build them with
    _msg() or pass through generate() below for the common system+user case.
    """
    global _last_good_model
    order = (
        [_last_good_model] + [m for m in MODEL_CHAIN if m != _last_good_model]
        if _last_good_model
        else MODEL_CHAIN
    )
    last_error: Exception | None = None

    async with httpx.AsyncClient() as client:
        for model in order:
            for attempt in range(2):
                try:
                    text = await _call_chat(client, model, messages, max_tokens)
                    _last_good_model = model
                    return text
                except Exception as exc:
                    last_error = exc
                    if attempt == 0:
                        await asyncio.sleep(0.6)

        # Last-tier: most-current model, shorter final user turn only
        try:
            shortened = [m for m in messages if m.get("role") != "user"]
            last_user = next((m for m in reversed(messages) if m.get("role") == "user"), None)
            if last_user:
                parts = last_user.get("content")
                text_val = parts[0]["text"] if isinstance(parts, list) and parts else str(parts)
                shortened = shortened + [_msg("user", text_val[:400])]
            text = await _call_chat(client, MODEL_CHAIN[0], shortened or messages, max_tokens)
            return text
        except Exception as exc:
            last_error = exc

    raise RuntimeError(f"{last_error} — tried {len(order)} models")


async def generate(system: str, user: str, max_tokens: int = 1000) -> str:
    """Convenience wrapper for the common single-turn system+user case."""
    messages = []
    if system:
        messages.append(_msg("system", system))
    messages.append(_msg("user", user))
    return await generate_messages(messages, max_tokens)


async def ping() -> dict:
    """Test connectivity; return the first responding model and its reply."""
    errors: list[str] = []
    async with httpx.AsyncClient() as client:
        for model in MODEL_CHAIN:
            try:
                reply = await _call_chat(
                    client, model, [_msg("user", "Reply with the single word: ready")], 20
                )
                global _last_good_model
                _last_good_model = model
                return {"model": model, "reply": reply.strip()}
            except Exception as exc:
                errors.append(f"{model}: {exc}")

        # All configured models failed — list available ones to help diagnose
        try:
            live = await list_available_models_inner(client)
            if live:
                raise RuntimeError(
                    f"{' · '.join(errors)} — none of the configured models worked, but this "
                    f"project can currently reach: {', '.join(live[:8])}. "
                    f"Update MODEL_CHAIN in backend/watsonx.py to one of these."
                )
        except RuntimeError:
            raise
        except Exception:
            pass

    raise RuntimeError(" · ".join(errors))


async def list_available_models_inner(client: httpx.AsyncClient) -> list[str]:
    token = await _get_token(client)
    resp = await client.get(
        f"{WX_BASE}/ml/v1/foundation_model_specs?version=2024-05-01&filters=function_text_generation",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=20,
    )
    data = resp.json()
    if not resp.is_success:
        raise RuntimeError(f"Could not list models (status {resp.status_code})")
    return [m["model_id"] for m in (data.get("resources") or []) if m.get("model_id")]


async def list_available_models() -> list[str]:
    async with httpx.AsyncClient() as client:
        return await list_available_models_inner(client)


import json
import re as _re


def parse_json(text: str) -> dict:
    clean = _re.sub(r"```json|```", "", text).strip()
    start = clean.find("{")
    end = clean.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("The reply wasn't in the expected format.")
    return json.loads(clean[start : end + 1])
