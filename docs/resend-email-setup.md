# Resend Email Setup — Required Configuration & Known Issues

This file documents every issue encountered setting up Resend for DreamPlay Composer,
so future setups don't repeat the same mistakes.

---

## ✅ Checklist — Do this before sending any emails

### 1. Verify the sending domain in Resend (DKIM)
- Go to Resend dashboard → **Domains** → Add domain
- Add the domain you'll send from (e.g. `dreamplay.studio`)
- Add the DKIM TXT record Resend gives you to your DNS:
  ```
  Name:  resend._domainkey.dreamplay.studio
  Type:  TXT
  Value: p=MIGf... (Resend provides this)
  ```
- Wait for Resend to show "Verified" before sending

### 2. Add SPF record — CRITICAL, easy to forget
**This is the #1 silent failure cause.** Without correct SPF, Gmail silently drops ~50% of emails
(they show "Sent" in Resend but never arrive in inbox OR spam — no trace).

Add to your DNS:
```
Name:  @  (root domain — NOT a subdomain like "send")
Type:  TXT
Value: v=spf1 include:_spf.resend.com ~all
TTL:   Auto
```

> **Bug encountered (Apr 2026):** Blast of 15 emails — 7 showed "Sent" in Resend for
> 13+ minutes, never arrived in inbox or spam initially. Root cause: **Gmail deferred
> delivery**. Gmail accepted the emails at SMTP level but queued them in its ML-based
> reputation filter because of bulk volume from an infrequently-used sender. After
> ~4 hours, Gmail finished its assessment, confirmed the domain was legitimate, and
> delivered all emails to inboxes.
>
> Contributing factors:
> 1. **Missing List-Unsubscribe headers** — Gmail trusts bulk senders more when
>    RFC 8058 one-click unsubscribe headers are present. Now added to all routes.
> 2. **Cold sender** — hadn't sent a blast in a while, so Gmail applied extra scrutiny.
>
> **Resolution:** All emails were eventually delivered. No DNS config error.
>
> ⚠️ Expect 1-4 hour delays on new blasts until sender reputation is established.
> Sending regularly (weekly/biweekly) builds reputation and reduces deferral time.

### 3. Add DMARC record (optional but recommended)
DMARC ties SPF + DKIM together. Start with `p=none` (monitoring only):
```
Name:  _dmarc
Type:  TXT  
Value: v=DMARC1; p=none; rua=mailto:you@yourdomain.com
```
Later upgrade to `p=quarantine` once you've confirmed deliverability is stable.

### 4. Verify your FROM address matches the verified domain
- If domain is `dreamplay.studio`, your FROM must be `something@dreamplay.studio`
- Mismatched domain = DMARC alignment failure = spam or silent drop

---

## Architecture: Sending Emails

### Single email (support, transactional)
Route: `POST /api/admin/send-email`
- Sends one email via `resend.emails.send()`
- Personalizes `{{name}}` server-side with Supabase name lookup
- Includes unsubscribe link

### Bulk email (user blasts)
Route: `POST /api/admin/send-bulk-email`
- Receives all recipients in a single POST from the browser
- Sends via `resend.batch.send()` in batches of 100 (Resend's limit)
- 1500ms pause between batches (prevents Gmail receive-rate throttling)
- **Immune to browser tab close** — runs server-side entirely

> **Bug encountered (Apr 2026):** Old system used a client-side `for` loop calling
> `/api/admin/send-email` once per user with 300ms delays. If the browser tab was
> closed, navigated away, or the connection dropped mid-loop, the remaining emails
> were never sent. Fixed by moving the loop to a server-side batch route.

---

## Required Email Headers

Every outgoing email must include these headers (Google requirement since Feb 2024):
```typescript
headers: {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
},
```
Without these, Gmail aggressively filters emails from automated senders.

---

## Deliverability Tips

- **Always include both `text` and `html`** — plain text fallback improves spam scores
- **Don't send to unsubscribed users** — the admin email page skips `email_unsubscribed: true`
- **Don't burst too fast** — even with Resend's batch API, 1500ms per 100 emails is safer
- **Test with your own email first** before blasting all users
- **Check SPF, DKIM, DMARC** using https://mxtoolbox.com/SuperTool.aspx before first send

---

## Diagnosing "Sent but not Delivered"

| Symptom | Likely Cause |
|---|---|
| Shows "Sent" in Resend, not in inbox or spam | Missing SPF record |
| Shows "Sent" in Resend, lands in spam | DKIM not verified / DMARC failure |
| Shows "Delivered" in Resend, not in inbox | Gmail spam filter (content issue) |
| Only some emails sent from a blast | Old bug — client-side loop was killed mid-run |
| ~50% consistently not delivered | Both missing SPF AND rate limiting |

To diagnose: click any "Sent" email in Resend → view event timeline.
If it shows only `email.sent` with no follow-up event after 15+ minutes = silent drop = SPF issue.
