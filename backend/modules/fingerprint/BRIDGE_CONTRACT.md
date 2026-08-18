# Fingerprint Bridge Contract

The Shore Leave backend communicates with fingerprint hardware only through the
backend-configured `MANTRA_MFS110_BRIDGE_URL`. Browsers and React code must never
call this service.

## Security

- Bind the bridge to loopback unless it is protected by TLS and a private network.
- Configure the same private value in `FINGERPRINT_BRIDGE_TOKEN` on the bridge and
  Shore Leave backend.
- Return templates only to the authenticated Shore Leave backend.
- Never return, persist, or log raw fingerprint images.
- Never include templates in browser-facing API responses, Socket.IO messages, or
  application logs.

## Provider-Neutral Endpoints

### `GET /status`

```json
{
  "connected": true,
  "status": "ONLINE",
  "provider": "MANTRA_MFS110",
  "deviceModel": "Mantra MFS110",
  "serialNumber": "DEVICE-SERIAL",
  "sdkVersion": "SDK-VERSION"
}
```

### `POST /capture`

Request:

```json
{
  "deviceType": "MANTRA_MFS110",
  "device": "MFS110",
  "format": "ISO_TEMPLATE",
  "timeoutMs": 30000,
  "includeImage": false
}
```

Response:

```json
{
  "template": "BASE64_TEMPLATE",
  "templateVersion": "ISO",
  "quality": 80,
  "provider": "MANTRA_MFS110",
  "deviceModel": "Mantra MFS110",
  "serialNumber": "DEVICE-SERIAL",
  "sdkVersion": "SDK-VERSION"
}
```

### `POST /match`

Request:

```json
{
  "deviceType": "MANTRA_MFS110",
  "device": "MFS110",
  "storedTemplate": "BASE64_TEMPLATE",
  "liveTemplate": "BASE64_TEMPLATE"
}
```

Response:

```json
{
  "matched": true,
  "score": 92,
  "threshold": 70
}
```

The bridge owns SDK initialization, scanner discovery, capture timeouts, device
reconnection, template generation, and provider-specific matching. A future
scanner can implement this contract under another `FINGERPRINT_DEVICE_TYPE`
without frontend or gate-business-logic changes.
