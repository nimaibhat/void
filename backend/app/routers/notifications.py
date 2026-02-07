"""Notifications API Router — endpoints for alert confirmations and payouts."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.alert_notification_service import (
    send_confirmation_notification,
    send_payout_notification,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class ConfirmationRequest(BaseModel):
    """Request body for confirmation notification (simulation-style)."""

    profile_id: str
    alert_title: str
    action_taken: str  # "ACCEPT" | "DECLINE"
    success: bool
    device_type: str | None = None
    savings_added: float = 0
    savings_pending: float = 0
    payout_threshold: float = 10.0
    message: str | None = None


class PayoutRequest(BaseModel):
    """Request body for payout notification (simulation-style)."""

    profile_id: str
    amount_usd: float
    tx_hash: str
    total_paid: float | None = None


@router.post("/confirm")
async def send_confirmation(req: ConfirmationRequest):
    """Send confirmation notification after alert response (simulation-style)."""
    success = await send_confirmation_notification(
        profile_id=req.profile_id,
        alert_title=req.alert_title,
        action_taken=req.action_taken,
        success=req.success,
        message=req.message,
        device_type=req.device_type,
        savings_added=req.savings_added,
        savings_pending=req.savings_pending,
        payout_threshold=req.payout_threshold,
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to send notification")

    return {"ok": True, "message": "Notification sent"}


@router.post("/payout")
async def send_payout(req: PayoutRequest):
    """Send payout notification after XRPL transfer (simulation-style)."""
    success = await send_payout_notification(
        profile_id=req.profile_id,
        amount_usd=req.amount_usd,
        tx_hash=req.tx_hash,
        total_paid=req.total_paid,
    )

    if not success:
        raise HTTPException(status_code=500, detail="Failed to send notification")

    return {"ok": True, "message": "Notification sent"}
