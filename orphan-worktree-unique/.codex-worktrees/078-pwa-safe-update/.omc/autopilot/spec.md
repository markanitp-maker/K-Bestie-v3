# Autopilot Spec — 078 PWA Safe Update Gate

Detailed requirements are defined by `requests/078-pwa-safe-update-gate-request.md` in the primary workspace and normalized in `docs/plans/078-pwa-safe-update-gate.md`.

Acceptance is gated by: no forced update during active Mission/Free Chat, metadata-only safe-screen checks, a non-dismissible central update gate only for confirmed mismatch, confirmed Service Worker activation before reload, retryable failure UX, PII-free telemetry, unchanged durable Mission/Free Chat data, independent static review, Dev E2E, clean build, and Owner-approved Production deployment plus smoke checks.
