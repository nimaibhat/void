"""Claude-enhanced alert text generation for the orchestrator pipeline.

Uses Claude Haiku to rewrite template alert text into concise, personalised
prose that references ERCOT average utility rates for context.

Falls back to the original text on any error or timeout.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List

logger = logging.getLogger("blackout.claude")

# ── ERCOT pricing context ─────────────────────────────────────────────

ERCOT_PRICING_CONTEXT = """
ERCOT Residential Electricity Pricing Reference (Texas):
- Average residential rate: $0.12/kWh (~$60/MWh wholesale equivalent)
- Typical off-peak wholesale: $20-35/MWh
- Typical on-peak wholesale: $50-80/MWh
- Summer peak wholesale: $100-300/MWh
- Extreme events (URI 2021): wholesale cap $9,000/MWh
- Normal wholesale average: $35-45/MWh
- Average monthly residential bill: ~$150-175
- Average monthly consumption: ~1,200 kWh
- Critical grid threshold: >$1,000/MWh wholesale indicates severe stress
""".strip()

SYSTEM_PROMPT = f"""You are a grid operations alert writer for Blackout, a Texas power grid monitoring system.
You write SHORT, clear, actionable alert text for utility operators and consumers.

Rules:
- Each alert gets a rewritten "title" (max 70 chars) and "description" (max 200 chars).
- Reference actual numbers from the alert data — never invent figures.
- Compare prices to ERCOT averages to give context (e.g. "15x normal wholesale", "well below the $45/MWh average").
- For cascade alerts, convey urgency proportional to the scale of failure.
- For price alerts, translate wholesale $/MWh to consumer impact where possible.
- Be direct and professional. No exclamation marks. No filler words.
- Return valid JSON array: [{{"title": "...", "description": "..."}}]
- Return ONLY the JSON array, no markdown fences, no explanation.
- Array order must match the input alert order.

{ERCOT_PRICING_CONTEXT}"""


# ── Client setup ──────────────────────────────────────────────────────

_client = None


def _get_client():
    global _client
    if _client is not None:
        return _client

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set — Claude enhancement disabled")
        return None

    try:
        import anthropic
        _client = anthropic.Anthropic(api_key=api_key)
        return _client
    except ImportError:
        logger.warning("anthropic package not installed — Claude enhancement disabled")
        return None


# ── Public API ────────────────────────────────────────────────────────


def enhance_alerts(alerts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Enhance orchestrator alert text using Claude Haiku.

    Takes the list of alert dicts (as prepared for Supabase insertion)
    and returns the same list with title/description potentially rewritten.

    Falls back to original text on any error.
    """
    if not alerts:
        return alerts

    client = _get_client()
    if client is None:
        return alerts

    # Build prompt with alert data
    alert_descriptions = []
    for i, a in enumerate(alerts):
        meta = a.get("metadata", {})
        meta_str = ", ".join(f"{k}={v}" for k, v in meta.items()) if meta else "none"
        alert_descriptions.append(
            f'{i+1}. type={a.get("alert_type", "unknown")} severity={a.get("severity", "warning")}\n'
            f'   title="{a.get("title", "")}"\n'
            f'   description="{a.get("description", "")}"\n'
            f'   metadata: {meta_str}'
        )

    user_message = (
        f"Rewrite these {len(alerts)} alerts with better prose. "
        f"Keep the same meaning and all numeric values.\n\n"
        + "\n".join(alert_descriptions)
    )

    try:
        import anthropic

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_message}],
            timeout=5.0,
        )

        text = response.content[0].text if response.content else ""
        cleaned = text.replace("```json", "").replace("```", "").strip()
        enhanced: List[Dict[str, str]] = json.loads(cleaned)

        if len(enhanced) != len(alerts):
            logger.warning(
                "Claude returned %d alerts but expected %d — falling back",
                len(enhanced), len(alerts),
            )
            return alerts

        for i, e in enumerate(enhanced):
            if e.get("title"):
                alerts[i]["title"] = e["title"]
            if e.get("description"):
                alerts[i]["description"] = e["description"]

        logger.info("Claude enhanced %d alert(s)", len(alerts))
        return alerts

    except Exception as exc:
        logger.warning("Claude enhancement failed: %s — using original text", exc)
        return alerts
