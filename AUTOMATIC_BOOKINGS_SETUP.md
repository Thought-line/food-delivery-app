# Automatic bookings + Razorpay payments — setup runbook

This change makes bookings confirm themselves on payment, prevents double
bookings instantly, and auto-releases a booking nobody paid for within 15
minutes. Active/Completed stay a deliberate tap by the admin at pickup/return
(see step 7a) — a camera rental is a physical handover, not just a date. The
code is in the repo; the steps below are the things only you can do (accounts,
secrets, deploys). Do them in order.

---

## 0. Pre-flight (read-only — 2 minutes)

In the Supabase SQL editor, run these and skim the output. They exist because
`confirm_booking` / `reject_booking` / `cancel_booking` live only on the DB, and
nothing else here should have surprised us:

```sql
select pg_get_functiondef(oid)
from pg_proc
where proname in ('confirm_booking','reject_booking','cancel_booking','set_camera_status');

select tgname, tgrelid::regclass, tgfoid::regproc
from pg_trigger where not tgisinternal;

select extname from pg_extension;              -- is pg_cron already there?
select jobname, schedule, command from cron.job;  -- only if pg_cron exists
```

If `pg_cron` is not listed, enable it: **Dashboard → Database → Extensions →
search "pg_cron" → enable**. (The migration also tries `create extension`, but
the dashboard toggle is the reliable path.)

---

## 1. Razorpay account

1. Sign up at razorpay.com, stay in **Test Mode** (toggle, top-left).
2. **Settings → API Keys → Generate Test Key.** Copy `Key Id` (`rzp_test_…`) and
   `Key Secret`.
3. Webhook secret comes in step 4 (after the function URL exists).

---

## 2. Apply the database migration

Open `supabase/migrations/20260910000000_auto_confirm_and_payments.sql`, paste
the whole file into the Supabase SQL editor, run it.

It is idempotent. It adds `payment_status` / `amount_total` / `amount_paid` /
`hold_expires_at` to `bookings`, creates `payments` / `payment_bookings` /
`processed_webhook_events`, adds the RPCs, **backfills existing
confirmed/active/completed bookings to `payment_status = 'paid'`**, and schedules
two `pg_cron` jobs (`booking-hold-reaper` every minute, `booking-lifecycle`
every 15 min).

Verify:

```sql
select jobname, schedule, active from cron.job;
select payment_status, count(*) from bookings group by 1;
```

> If the backfill line errors with `no_overlapping_confirmed_bookings`, you have
> a pre-existing over-committed booking. The migration disables the stock
> trigger around the backfill specifically to avoid this, so it should not
> happen — but if it does, fix that booking's data first, then re-run.

---

## 3. Edge Function secrets

Supabase CLI (`npx supabase login` first, project is already linked):

```bash
npx supabase secrets set \
  RAZORPAY_KEY_ID=rzp_test_xxxxxxxx \
  RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxx \
  RAZORPAY_WEBHOOK_SECRET=placeholder_for_now
```

Or **Dashboard → Edge Functions → Manage secrets**. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically — don't set them.
(`MAILTRAP_*` / `BOOKING_EMAIL_FROM*` from the existing email function stay as
they are.)

---

## 4. Deploy the Edge Functions

```bash
npx supabase functions deploy create-booking-order
npx supabase functions deploy verify-payment
npx supabase functions deploy create-balance-order
npx supabase functions deploy send-booking-status-email
npx supabase functions deploy razorpay-webhook   # verify_jwt=false via supabase/config.toml
```

`supabase/config.toml` (new, minimal) pins `verify_jwt = false` for
`razorpay-webhook` only. If you deploy without the CLI reading that file, add
`--no-verify-jwt` to that one command.

The webhook URL is now:
`https://xwbdkamzsitltnmsdmpz.supabase.co/functions/v1/razorpay-webhook`

---

## 5. Register the Razorpay webhook

**Razorpay Dashboard → Settings → Webhooks → Add New Webhook:**

- URL: the webhook URL above
- Secret: make one up (strong random string)
- Events: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`
- Save.

Then set that same secret as the real `RAZORPAY_WEBHOOK_SECRET`:

```bash
npx supabase secrets set RAZORPAY_WEBHOOK_SECRET=the_secret_you_just_made
npx supabase functions deploy razorpay-webhook   # redeploy to pick it up
```

---

## 6. Frontend

Nothing to configure — the Razorpay key id is returned by the Edge Function, and
`checkout.js` loads from Razorpay's CDN on demand. Just build and deploy as
usual:

```bash
npm run build
npm run lint
```

---

## 7a. Manual pickup/return (run this too)

A camera rental is a physical handover — the pickup/return date alone doesn't
prove the camera changed hands. So Active/Completed are now an admin tap
("Mark handed over" / "Mark returned" in the Admin panel), not automatic.
Confirm is unaffected — still fully automatic on payment.

Paste `supabase/migrations/20260911000000_manual_pickup_return.sql` into the
SQL editor and run it. It unschedules the `booking-lifecycle` cron job (the
`booking-hold-reaper` job stays — releasing an unpaid hold isn't a physical
event, so that's still automatic).

Verify:
```sql
select jobname, active from cron.job;   -- 'booking-lifecycle' should be gone
```

---

## 7b. Pickup verification code (run this too)

When a payment is captured, a 6-digit pickup code is generated and emailed to
the customer (in the same confirmation email). At pickup, the admin asks the
customer for it and types it into the **Mark handed over** dialog — it has to
match or the tap is refused, so a random person can't claim someone else's
booking.

Paste `supabase/migrations/20260911010000_pickup_verification_code.sql` into
the SQL editor and run it. No new secrets or function deploys needed — it
only touches the database and the already-deployed `send-booking-status-email`
function picks up the new field automatically.

---

## 7c. Pickup code by SMS (testing only, run this too)

A real OTP text is sent via **Twilio Verify** (see
`supabase/functions/_shared/sms.ts`) whenever a payment settles. Two providers
were tried before landing here — worth knowing why:
- **Fast2SMS**'s OTP route still requires India's DLT sender/template
  registration (business/GST paperwork, days to approve).
- **Twilio's plain Messages API** on a trial account refused custom message
  text (error 572006 — trial accounts can only use Twilio's own pre-approved
  templates).
- **Twilio Verify** is Twilio's purpose-built OTP product — trial-compliant,
  since it sends its own pre-approved template. The trade-off: Twilio
  generates and owns that code, so it is **not** the same value as
  `bookings.pickup_code`. The actual pickup verification (what the admin
  types into "Mark handed over") is unchanged — still the database code,
  emailed to the customer. This SMS is a separate, independent proof that OTP
  delivery works; nothing in the app checks the Twilio-generated code against
  anything.

Trial limitation either way: Twilio only delivers to a phone number you've
manually verified in its console — fine for your own number, not for
arbitrary customers (needs a paid number later). Email keeps sending
regardless — this is additive, not a replacement.

1. Sign up at **https://www.twilio.com/try-twilio**.
2. **Console → Phone Numbers → Verified Caller IDs** — verify your own number
   (or use Twilio's guided "Start SMS trial" flow, which does this for you).
3. **Console → Verify → Services** — create a new Verify Service (any
   friendly name, e.g. "DreamCapture Pickup"). Copy its **Service SID**
   (starts `VA...`).
4. **Console → Account → API keys & auth tokens → Auth tokens** — copy your
   **Account SID** and **Auth Token** (use the copy icon, not the visible
   text — it's easy to copy a truncated value by accident).
5. Set the secrets and redeploy the two functions that send it:
   ```bash
   npx supabase secrets set \
     TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
     TWILIO_AUTH_TOKEN=your_auth_token \
     TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   npx supabase functions deploy verify-payment
   npx supabase functions deploy razorpay-webhook
   ```
6. Run `supabase/migrations/20260911020000_pickup_code_sms_tracking.sql` in
   the SQL editor (so a balance payment doesn't re-text) if you haven't
   already.

Test: book + pay using **your own verified phone number**, and check that
phone for a Twilio OTP text.

`FAST2SMS_API_KEY` and `TWILIO_FROM_NUMBER` (from the earlier attempts) are
harmless to leave set — nothing calls them anymore.

---

## 7d. Notify + refund customers when a booked camera is removed (run this too)

When an admin removes ("retires") a camera from `CameraManager` that already
has live bookings on it, those bookings now get cancelled automatically, and
the affected customers get emailed — either "refund on its way (4–7 working
days)" for any booking with a captured payment (an automatic Razorpay refund
is attempted; if it fails, `payments.needs_refund = true` is set, same manual
fallback used elsewhere), or a plain cancellation notice if nothing was
captured yet.

1. Paste `supabase/migrations/20260914000000_camera_removal_refunds.sql` into
   the SQL editor and run it. Adds the `admin_retire_camera()` RPC and an RLS
   policy so a booking's camera name/price still show after the camera is
   retired (mirrors the existing wishlist fix).
2. No new secrets — reuses `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` and
   `MAILTRAP_*`, already set from steps 1 and 3 above.
3. Deploy the new/changed functions:
   ```bash
   npx supabase functions deploy send-booking-status-email
   npx supabase functions deploy retire-camera
   ```

Test: book + pay a test camera, then remove it from `CameraManager`. Confirm
the booking flips to `cancelled` in Admin, the customer gets the refund email
with the correct amount, and My Bookings still shows the camera's name (not
blank) with a "Refund pending"/"Refunded" badge.

---

## 7. Smoke test (Test Mode)

Test card `4111 1111 1111 1111`, any future expiry, any CVV, OTP `1234`.
Test UPI: `success@razorpay`.

| # | Do this | Expect |
|---|---|---|
| 1 | Book a camera, **Pay full**, complete payment | Booking `confirmed` + `payment_status = paid`; shows in My Bookings and Admin → Confirmed; "paid" email |
| 2 | Book, **Pay 25% advance** | `advance_paid`, "₹X balance due"; **Pay balance** button → pay → `paid` |
| 3 | Two browsers, `stock_quantity = 1`, overlapping dates, both start checkout | First hold wins; second gets "not available" instantly, no booking row |
| 4 | Reach the Razorpay modal, close it | Booking gone at once (`cancel_unpaid_hold`); unit bookable again |
| 5 | Reach the modal, kill the tab, wait ~17 min | `booking-hold-reaper` cancels it (`payment_status = expired`) |
| 6 | On a Confirmed, paid booking, admin clicks **Mark handed over**, types the *wrong* code | Rejected with a clear message; dialog stays open to retry |
| 6a | Same booking, type the *correct* code (from the confirmation email) | `status = active`; customer gets a "Booking Active" toast + email |
| 7 | On that Active booking, admin clicks **Mark returned** | `status = completed`; review prompt eligible + email |
| 6b | Leave a paid Confirmed booking's pickup date in the past without clicking anything | Admin panel shows a **"Pickup overdue"** badge on it |
| 8 | Razorpay Dashboard → resend a `payment.captured` webhook | No double-apply (`amount_paid` unchanged); idempotent |
| 9 | Cart with 2 cameras (one already booked out for its dates), checkout | One modal for the available one; the other stays in the cart with a warning |

Watch the cron:

```sql
select * from cron.job_run_details order by start_time desc limit 10;
```

---

## What changed for you day-to-day

- **You no longer approve bookings.** They confirm themselves when the customer
  pays (25% advance or full). The Admin panel opens on the **Confirmed** tab now.
- The old **Requested** tab (and its Confirm/Reject buttons) has been removed
  from the Admin panel — the legacy backlog it existed to drain is cleared, and
  no booking is created with that status anymore.
- **Active / Completed are a tap, not automatic.** When a customer collects a
  camera, click **Mark handed over**; when they bring it back, **Mark
  returned**. That's what makes the status trustworthy — it always reflects
  who really has the camera, and a no-show shows up as a **Pickup overdue**
  badge instead of silently ticking through the states.
- **Cancel** stays a manual override for exceptions.
- New **Payment** column shows advance/paid/refund state per booking.
- If a payment lands after its 15-min hold expired (rare), the booking is left
  cancelled and the payment is auto-refunded; `payments.needs_refund = true`
  flags any refund that didn't go through for you to handle in Razorpay.

## Tunable constants (in the migration)

- Hold window: `interval '15 minutes'` in `create_booking_hold`
- Reaper reconcile margin: `interval '3 minutes'` in `expire_booking_holds`
- Advance percentage: `Math.ceil(totalPaise / 4)` (25%) in
  `supabase/functions/_shared/pricing.ts`

(`run_booking_lifecycle` / auto-activate-complete is disabled — see
`20260911000000_manual_pickup_return.sql`. Active/Completed are an admin tap.)
