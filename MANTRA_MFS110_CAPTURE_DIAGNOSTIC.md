# Mantra MFS110 Capture Diagnostic

## Scope

This diagnostic isolates the physical capture path only:

`USB -> MFS110 -> Windows driver -> Mantra RD Service -> local adapter -> capture endpoint`

No leave validation, check-in/check-out business logic, OTP, email, MongoDB transaction, dashboard update, or UI behavior was used for this test.

## Commands Run

- `Get-Service` search for Mantra/MFS/RD/AVDM/fingerprint services
- `Get-PnpDevice` search for Mantra/MFS/fingerprint/biometric devices
- `curl.exe -X RDSERVICE http://127.0.0.1:11100`
- `curl.exe -X DEVICEINFO http://127.0.0.1:11100`
- `npm --prefix backend run fingerprint:adapter`
- `GET http://127.0.0.1:11111/status`
- `POST http://127.0.0.1:11111/capture`

## Hardware

- MFS110 detected by this Windows session: NO
- Windows driver state: NOT FOUND in `Get-PnpDevice` search
- USB/device manager state: NOT VERIFIED visually in Device Manager

## RD Service

- Installed service found by service search: NO
- Running service found by service search: NO
- `127.0.0.1:11100` reachable: NO
- `RDSERVICE` response: NO CONNECTION
- `DEVICEINFO` response: NO CONNECTION
- Compatible RD response observed: NO

## Provider / Adapter

- Local adapter startup before dependency install: FAILED because backend dependencies were not installed in this clone.
- Backend dependencies installed: YES
- Local adapter now starts: YES
- Adapter port aligned with configured bridge URL: YES, default changed to `127.0.0.1:11111`
- Adapter status result: FAIL, `RD_SERVICE_UNAVAILABLE`
- Adapter capture result: FAIL, `RD_SERVICE_UNAVAILABLE`

## Capture

- Capture request sent to local adapter: YES
- RD request received by Mantra RD service: NO, RD service is unreachable
- Finger detected: NOT TESTED, capture cannot reach RD service
- Capture completed: NO
- Response received: NO
- Response parsed: NO

## Matching

- Matching attempted: NO
- Matching result: NOT_SUPPORTED in current local adapter unless a real matching provider is configured
- Important note: local adapter hash comparison is disabled by default because comparing captured biometric payload hashes is not valid fingerprint matching.

## Gate

- Checkout: NOT TESTED, physical capture failed before gate logic
- Check-in: NOT TESTED, physical capture failed before gate logic
- Email OTP backend lookup: UPDATED to resolve registered email even when supplied as the generic identity value

## Root Cause Found

The physical capture pipeline does not currently reach the Mantra RD service. On this machine, Mantra RD is not listening at `http://127.0.0.1:11100`, and no Mantra/MFS service or PnP device was found through command-line checks. The application cannot make the MFS110 react until the Windows driver/RD service layer is installed, running, and reachable.

## Required Hardware Fix

Install or start the correct Mantra MFS110 RD/AVDM service on the gate computer, confirm Windows Device Manager shows the MFS110 without errors, and confirm:

- `curl.exe -X RDSERVICE http://127.0.0.1:11100` returns RD service XML
- `curl.exe -X DEVICEINFO http://127.0.0.1:11100` returns device info XML
- `GET http://127.0.0.1:11111/status` returns `READY_FOR_CAPTURE`
- `POST http://127.0.0.1:11111/capture` causes the physical MFS110 to capture a placed finger

Do not proceed to gate check-out/check-in until the direct adapter capture test passes.
