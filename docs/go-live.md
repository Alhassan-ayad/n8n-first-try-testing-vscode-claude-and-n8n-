# Go-live checklist

Everything runs in `PROVIDER_MODE=mock` until the steps below are done. Going live means filling in `.env` and restarting `api` and `worker`. No code changes are needed.

## 1. mngm core database (CDC)

1. A DBA runs [`docs/sql/enable-cdc.sql`](sql/enable-cdc.sql) on the production mngm core database. SQL Server Agent must be running.
2. Compare the real table and column names with [`packages/cdc/src/mappings.ts`](../packages/cdc/src/mappings.ts). The mappers are the only place that knows the source schema. Adjust them if the names differ, then run `npm test`.
3. Set `SOURCE_MSSQL_URL` to the read-only `cep_reader` login.
4. Leave `CDC_START=latest` so history is not replayed as new messages. To import the existing client base, run the nightly scan instead (step 6).

## 2. SMS — eZagel

1. Register the sender ID (e.g. `mngm`) with eZagel for both Arabic and English traffic.
2. Fill in `EZAGEL_BASE_URL`, `EZAGEL_USERNAME`, `EZAGEL_PASSWORD`, `EZAGEL_SENDER_ID` and, if your account uses one, `EZAGEL_SERVICE`.
3. Match the request to eZagel's API document. All of it is configurable:
   - `EZAGEL_REQUEST_FORMAT` — `form`, `json` or `query`
   - `EZAGEL_PARAM_MAP` — rename fields, e.g. `{"username":"User","password":"Password","mobile":"Mobile_NO","message":"Msg","sender":"Sender","msgId":"Msg_ID"}`
   - `EZAGEL_PHONE_FORMAT` — `intl` (201…) or `local` (01…)
   - `EZAGEL_SUCCESS_PATTERN` — regex that marks an accepted response, if eZagel returns 200 with a status code in the body
4. Give eZagel the callback URLs. They are listed in Console → Providers & settings:
   - Delivery receipts: `https://<api>/webhooks/ezagel/dlr?token=<EZAGEL_WEBHOOK_TOKEN>`
   - Inbound SMS (opt-out keywords STOP / إلغاء): `https://<api>/webhooks/ezagel/inbound?token=<EZAGEL_WEBHOOK_TOKEN>`
5. Set `SMS_MODE=live`, then use Console → Providers → *Provider smoke test* to send an SMS to your own phone.

## 3. Email — SendGrid

1. Authenticate two sending subdomains (SPF, DKIM, DMARC). The plan keeps transactional and marketing mail separate:
   - Transactional: `tx.mngm.com` → `SENDGRID_FROM_TRANSACTIONAL`
   - Marketing: `mail.mngm.com` → `SENDGRID_FROM_MARKETING`
2. Create an API key with *Mail Send* permission → `SENDGRID_API_KEY`.
3. Create an unsubscribe group for marketing → `SENDGRID_UNSUB_GROUP_ID`.
4. Optional: create dedicated IP pools → `SENDGRID_IP_POOL_*`.
5. Event Webhook:
   - URL: `https://<api>/webhooks/sendgrid`
   - Events: delivered, open, click, bounce, dropped, spam report, unsubscribe, group unsubscribe
   - Turn on *Signed Event Webhook* and paste the verification key into `SENDGRID_WEBHOOK_PUBLIC_KEY`.
6. Set `EMAIL_MODE=live` and run the smoke test.

## 4. Push — Firebase Cloud Messaging

1. In the Firebase console, go to Project settings → Service accounts → *Generate new private key*.
2. Save the key as `secrets/firebase-service-account.json` (mounted read-only into the containers), or paste the JSON into `FIREBASE_SERVICE_ACCOUNT_JSON`.
3. The mobile app must:
   - Register its token after login: `POST /v1/clients/{id}/devices`. Remove it on logout with `DELETE`.
   - Create the Android notification channels `transactional`, `prices`, `service` and `offers_and_news`.
   - Route `data.deepLink` (e.g. `mngm://app/orders/123`) to the matching screen.
4. Set `PUSH_MODE=live` and run the smoke test with a real device token.

## 5. Content approval

1. Set `TEMPLATE_REQUIRE_APPROVAL=true`. This is the production default.
2. Compliance opens Console → Templates → *Coverage*. Every row must show approved Arabic and English versions.
3. Compliance reviews and approves each template. The submitter cannot approve their own template (four-eyes rule).

## 6. Switch on

1. Set `PROVIDER_MODE=live` (or the per-channel `*_MODE` values) and restart `api` and `worker`.
2. Create named users with real roles (`compliance`, `head_of_marketing`, `cfo`, `ceo`, `crm`, `callcentre`…). Then change the seeded admin password, or disable that account.
3. Import the existing base:
   - The worker's nightly 02:00 scan enrols never-activated clients into the activation journey, and former instalment-finance clients into their journey.
   - Run a one-time consent refresh campaign (plan §13.1).
4. Watch Console → Dashboard for the first hour: delivery rates, and the opt-out stop thresholds.

## Security notes

- Change `ADMIN_JWT_SECRET`, `CLIENT_API_HMAC_SECRET`, `UNSUBSCRIBE_SECRET`, `EZAGEL_WEBHOOK_TOKEN` and the admin password.
- Serve the API behind TLS. The console's nginx proxies `/api` to it.
- OTP codes are never stored. Message bodies are redacted after send, and event payloads are redacted on write.
