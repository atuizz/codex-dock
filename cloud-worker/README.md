# Codex Cloud Console Worker

Cloudflare Worker + Static Assets + D1 backend for `https://codex.woai.pro`.

## Commands

```powershell
npm install
npm run build
npx wrangler d1 execute codex-cloud-console --remote --file ./schema.sql
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler deploy
```

## Runtime Shape

- Static assets: `index.html`, `app.js`, `styles.css` copied into `cloud-worker/public`.
- API: `/api/*` served by `worker.js`.
- Database: D1 binding `DB`.
- Secret: `TOKEN_ENCRYPTION_KEY`, used to encrypt account auth/session payloads before storage.
- Custom domain: `codex.woai.pro`.

## Safety Boundary

`GET /api/accounts` returns only metadata and usage snapshots. Token material is encrypted in `account_secrets` and is only decrypted for `POST /api/accounts/:id/switch-payload` after the cloud user is logged in.
