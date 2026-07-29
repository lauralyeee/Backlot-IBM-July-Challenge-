"""
watsonx.ai / IBM Granite client -- server-side.

Credentials (WATSONX_API_KEY, WATSONX_PROJECT_ID) live only here; the
browser never sees them. The frontend calls /api/generate, /api/ping,
/api/models -- this module handles the actual IBM calls.

Uses the chat-completions endpoint (/ml/v1/text/chat) rather than raw
completion, so watsonx.ai applies each model's own chat template and stop
handling instead of us hand-formatting Granite's template and guessing at
a stop signal.
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

# Keep in sync with src/lib/watsonx.js MODEL_CHAIN. Primary is IBM Granite;
# fallback is mistral-medium-2505, the strongest model confirmed reachable
# on this account/region after granite-3-3-8b-instruct turned out not to
# be. If IBM deprecates a model, use /api/models to find live IDs.
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


async def _call_chat_stream(client: httpx.AsyncClient, model: str, messages: list[dict], max_tokens: int):
    """Streaming counterpart to _call_chat(): hits watsonx.ai's SSE chat
    endpoint and yields text deltas as they arrive, instead of returning
    the full reply in one shot."""
    import json as _json

    token = await _get_token(client)
    got_any = False
    async with client.stream(
        "POST",
        f"{WX_BASE}/ml/v1/text/chat_stream?version=2024-05-31",
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
            "Accept": "text/event-stream",
        },
        timeout=60,
    ) as resp:
        if not resp.is_success:
            body = await resp.aread()
            raise RuntimeError(f"status {resp.status_code}: {body.decode(errors='ignore')[:300]}")
        async for line in resp.aiter_lines():
            if not line or not line.startswith("data:"):
                continue
            payload = line[len("data:"):].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                data = _json.loads(payload)
            except ValueError:
                continue
            if data.get("errors"):
                raise RuntimeError((data["errors"][0] or {}).get("message", "stream error"))
            choices = data.get("choices") or []
            if not choices:
                continue
            delta = (choices[0].get("delta") or {}).get("content", "")
            if delta:
                got_any = True
                yield delta
    if not got_any:
        raise RuntimeError("empty streamed response from model")


_last_good_model: str | None = None


async def generate_messages_stream(messages: list[dict], max_tokens: int = 500):
    """Streaming counterpart to generate_messages(): yields text deltas as
    they arrive instead of waiting for and returning the full reply.

    Falls back to the next model in MODEL_CHAIN only if a model fails
    *before* yielding any text. Once a model has started streaming real
    content, a later mid-stream failure just ends the generator (the caller
    already has whatever text arrived) rather than restarting a different
    model, which would show up as the reply abruptly resetting/duplicating
    on screen.
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
            started = False
            try:
                async for delta in _call_chat_stream(client, model, messages, max_tokens):
                    started = True
                    _last_good_model = model
                    yield delta
                return
            except Exception as exc:
                last_error = exc
                if started:
                    raise
                continue  # nothing streamed yet for this model — safe to try the next one

    raise RuntimeError(f"{last_error} — tried {len(order)} models")


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
