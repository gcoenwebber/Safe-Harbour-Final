# UptimeRobot Setup Guide

Prevent Render's free tier from sleeping by using UptimeRobot to ping your `/healthz` endpoint every 5 minutes.

## Setup Steps

### 1. Create Account
Go to [uptimerobot.com](https://uptimerobot.com) and create a free account.

### 2. Add New Monitor

| Setting | Value |
|---------|-------|
| **Monitor Type** | HTTP(s) |
| **Friendly Name** | Safe Harbour API |
| **URL** | `https://safe-harbour-api.onrender.com/healthz` |
| **Monitoring Interval** | 5 minutes |

> **Note**: Replace the URL with your actual Render deployment URL.

### 3. Configure Alerts (Optional)

1. Go to **My Settings** → **Alert Contacts**
2. Add your email address
3. When creating the monitor, select your email as an alert contact

## Expected Response

When healthy:
```json
{
  "status": "ok",
  "checks": {
    "redis": true,
    "supabase": true
  },
  "timestamp": "2026-02-01T02:19:00.000Z"
}
```

When degraded (503 status):
```json
{
  "status": "degraded",
  "checks": {
    "redis": false,
    "supabase": true
  },
  "timestamp": "2026-02-01T02:19:00.000Z"
}
```

## Why This Works

Render's free tier spins down after 15 minutes of inactivity. UptimeRobot's 5-minute pings keep the service warm, ensuring the dashboard is always responsive.
