# Client API for the mngm backend

The mngm backend calls these endpoints on behalf of the app. The full OpenAPI reference is served at `/docs`.

## Authentication

Every request is signed with HMAC-SHA256 using `CLIENT_API_HMAC_SECRET`:

```
x-cep-timestamp: <unix seconds>
x-cep-signature: hex(HMAC_SHA256(secret, `${timestamp}.${METHOD}.${path}.${rawBody}`))
```

- Requests older than 5 minutes are rejected.
- `path` excludes the query string.
- `rawBody` is the exact JSON string sent, or an empty string when there is no body.

```js
import { createHmac } from 'node:crypto';
const body = JSON.stringify({ token, platform: 'android' });
const ts = String(Math.floor(Date.now() / 1000));
const path = `/v1/clients/${userId}/devices`;
const sig = createHmac('sha256', SECRET).update(`${ts}.POST.${path}.${body}`).digest('hex');
await fetch(`${CEP}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-cep-timestamp': ts, 'x-cep-signature': sig }, body });
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/clients/{id}/devices` | Register or refresh an FCM token `{token, platform}` |
| DELETE | `/v1/clients/{id}/devices/{token}` | Remove a token on logout |
| POST | `/v1/clients/{id}/consents/registration` | Registration consent (all options unticked by default) `{emailMarketing, smsMarketing, whatsapp, pushPromotions, wordingVersion, wordingText}` |
| GET / PUT | `/v1/clients/{id}/preferences` | Preference centre: topic × channel switches, and language |
| GET | `/v1/clients/{id}/inbox` | In-app inbox and unread count |
| POST | `/v1/clients/{id}/inbox/{itemId}/read` | Mark an item read |
| GET | `/v1/clients/{id}/banners` | Active banners in the client's language |
| GET / POST / DELETE | `/v1/clients/{id}/price-alerts` | Client price alerts `{metal, direction, level, smsAlso, windowStart, windowEnd}` |
| POST | `/v1/clients/{id}/surveys/{survey}` | CSAT, NPS, activation drop-off or exit survey `{score, reason, text}` |
| POST | `/v1/otp` | Send a verification code `{phone \| email \| externalId, code}` within seconds |
| POST | `/v1/events` | Post events in the CDC taxonomy (an alternative or supplement to CDC) |

`{id}` is always the mngm core user id.

The preference centre shows Category A (account, security, transactions) as mandatory. The response carries the Arabic and English sentence to display.
