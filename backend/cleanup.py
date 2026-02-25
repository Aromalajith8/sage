"""
cleanup.py — Midnight Reset Engine
Runs continuously alongside the server.
Every minute it checks: which users have hit their regional midnight
and wipes their messages. Rooms are deleted when their timer expires.
"""

import os, logging
from datetime import datetime, timezone
from apscheduler.schedulers.background import BackgroundScheduler
from supabase import create_client
import pytz

log = logging.getLogger("sage.cleanup")
db = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))


def delete_expired_messages():
    """
    Delete all messages where expires_at <= now().
    expires_at is set to midnight of the sender's timezone when message is created.
    """
    now = datetime.now(timezone.utc).isoformat()
    result = db.table("messages")\
               .update({"deleted": True})\
               .lte("expires_at", now)\
               .eq("deleted", False)\
               .execute()
    count = len(result.data) if result.data else 0
    if count:
        log.info(f"[cleanup] Deleted {count} expired messages.")


def delete_expired_rooms():
    """Delete rooms that have passed their expiry."""
    now = datetime.now(timezone.utc).isoformat()
    expired = db.table("rooms").select("id").lte("expires_at", now).execute()
    for room in (expired.data or []):
        db.table("room_messages").delete().eq("room_id", room["id"]).execute()
        db.table("room_members").delete().eq("room_id", room["id"]).execute()
        db.table("rooms").delete().eq("id", room["id"]).execute()
        log.info(f"[cleanup] Deleted expired room {room['id']}")


def delete_burned_messages():
    """Delete burn-mode messages whose burn timer has passed."""
    now = datetime.now(timezone.utc).isoformat()
    result = db.table("messages")\
               .update({"deleted": True})\
               .lte("burned_at", now)\
               .eq("burn_mode", True)\
               .eq("deleted", False)\
               .execute()
    count = len(result.data) if result.data else 0
    if count:
        log.info(f"[cleanup] Burned {count} burn-mode messages.")


def get_midnight_utc(tz_name: str) -> datetime:
    """Get the next midnight in a given timezone, expressed in UTC."""
    try:
        tz = pytz.timezone(tz_name)
    except Exception:
        tz = pytz.UTC
    now_local = datetime.now(tz)
    midnight_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight_local.astimezone(pytz.UTC)


def calculate_message_expiry(sender_timezone: str) -> str:
    """
    Returns the ISO timestamp of the NEXT midnight in the sender's timezone.
    This is set as expires_at when a message is created.
    """
    try:
        tz = pytz.timezone(sender_timezone)
    except Exception:
        tz = pytz.UTC
    now_local = datetime.now(tz)
    # Next midnight = today's midnight + 1 day if we've already passed midnight
    next_midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    from datetime import timedelta
    next_midnight += timedelta(days=1)
    return next_midnight.astimezone(pytz.UTC).isoformat()


def start_scheduler():
    """Start the background cleanup scheduler. Call once at app startup."""
    scheduler = BackgroundScheduler()
    scheduler.add_job(delete_expired_messages, "interval", minutes=1,  id="expire_msgs")
    scheduler.add_job(delete_expired_rooms,    "interval", minutes=1,  id="expire_rooms")
    scheduler.add_job(delete_burned_messages,  "interval", seconds=10, id="burn_msgs")
    scheduler.start()
    log.info("[cleanup] Scheduler started.")
    return scheduler
