# Event taxonomy

Plan §11 calls this a Phase 1 deliverable. Every event is produced from SQL Server CDC on the mngm core database by the mappers in [`packages/cdc/src/mappings.ts`](../packages/cdc/src/mappings.ts). The same events can also be posted to `POST /v1/events` (HMAC-signed).

- Event ids are stable, so replays are idempotent.
- Payload fields not listed below are ignored.

| Event | Source table → condition | Payload | What it triggers |
|---|---|---|---|
| `client.registered` | `Users` insert | fullName, phone, email, language, source, isFormerInstalment | Welcome (A); activation journey |
| `client.updated` | `Users` update of profile columns | fullName, phone, email, language | Profile sync |
| `client.closed` | `Users.Status` → closed | reason | Exit survey; exits every journey |
| `client.login` | `Logins` insert | device | Activity (at-risk logic) |
| `otp.requested` | `OtpRequests` insert (prefer `POST /v1/otp`) | code, phone, email, purpose | OTP SMS, falls back to email |
| `ekyc.submitted` | `KycApplications.Status` → submitted | applicationId, attempt | Under-review notice |
| `ekyc.approved` | → approved | applicationId | Approval notice; exits activation; first-purchase journey |
| `ekyc.rejected` | → rejected | applicationId, reason, attempt | Fix-it notice; second rejection → manual call queue |
| `cash.in.settled` | `CashTransactions` in/settled | transactionId, amount, method | Cash received |
| `cash.out.requested` / `.executed` | out/requested, out/executed | transactionId, amount | Push + SMS + email |
| `order.started` | `Orders.Status` → started | orderId, side, metal, amount | Abandoned-order journey |
| `order.placed` | → placed | … | Order placed; exits abandoned-order journey |
| `order.executed` | → executed | orderId, side, metal, grams, pricePerGram, amount | Confirmation; CSAT at +24h; milestones; second purchase / recurring cross-sell |
| `order.failed` / `.cancelled` | → failed / cancelled | orderId, reason | Push + SMS + email with cause |
| `conversion.accepted` / `ready` / `dispatched` / `delivered` | `Conversions.Status` | conversionId, metal, grams, courier | Physical delivery updates |
| `delivery.scheduled` | `Conversions.DeliverySlotAt` set | slotAt, courierName, courierPhone | SMS now plus a reminder 2h before the slot |
| `upload.received` / `assayed` / `credited` | `Uploads.Status` | uploadId, metal, grams, purity | Upload updates |
| `gift.sent` / `gift.received` | `Gifts` insert | giftId, grams, recipient/sender | Sender and recipient notices (SMS invite if the recipient is not a client) |
| `plan.created` / `plan.cancelled` | `RecurringPlans` | planId, amount, metal, dayOfMonth | Confirmation; exits cross-sell |
| `plan.debit.upcoming` | Scheduler, 12:00, from `RecurringPlans.NextDebitDate` = T+2 | planId, amount, cashBalance | Reminder (SMS if push is off) |
| `plan.debit.succeeded` | `PlanDebits` succeeded | planId, grams, consecutiveMonths | Confirmation; cancels failure follow-ups; bonus progress |
| `plan.debit.failed` | `PlanDebits` failed | planId, reason, attemptNo | Immediate notice, follow-ups at T+1 and T+3, SMS from the second failure |
| `security.new_device` / `password_changed` / `bank_changed` | `SecurityEvents` insert | device | SMS + push + email |
| `price.tick` | `Prices` insert (IsStale = 0) | metal, buyPrice, sellPrice | Custom alerts, volatility and dip alerts; lifts a stale-feed pause |
| `price.feed.stale` | `Prices` insert (IsStale = 1) | metal, tradingPaused | Banner; push + email if trading is paused |

## Read-only tables (queried directly)

| Table | Used for |
|---|---|
| `Holdings` (UserId, Metal, Grams) | Single client view, value tiers, milestones, statements |
| `Wallets` (UserId, CashBalance) | Statements, debit reminders |
| `RecurringPlans` | Debit reminders (T−2) |
| `Orders` | Statements; pay-day pattern detection |
