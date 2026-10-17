# TODO

## Host online on Cloudflare (option 2: static site + shared saves)

Goal: one public URL, everyone's named saves in one place, free tier.

1. Port `server.js`'s save API to Cloudflare Pages Functions + KV:
   - `functions/api/health.js`, `functions/api/saves/index.js` (GET list), `functions/api/saves/[name].js` (GET / PUT / DELETE).
   - Same JSON contract as `server.js` (see README "Saves"): list `[{name,time,score,mult,missions}]`,
     slug = lowercase, `[^a-z0-9-]` → `-`, max 40 chars; PUT stamps `name` and `time`; 1 MB body limit.
   - KV namespace `SAVES` (bind in `wrangler.toml` / Pages settings); keep an `index` key or list with a prefix.
   - Keep `vite.config.js` proxy for local dev so `npm run dev` still uses `server.js`.
2. `wrangler.toml` (Pages project, `pages_build_output_dir = "dist"`), KV binding `SAVES`.
3. Deploy: `npm run build` then `npx wrangler pages deploy dist` (or connect the repo: build `npm run build`, output `dist`).
   First time: `npx wrangler login`, `npx wrangler kv namespace create SAVES`.
4. Add `--base` only if hosting under a sub-path (Pages root needs none).
5. Check: title loads over HTTPS, pointer lock works, LOAD GAME lists saves from KV, two browsers see the same list.
6. Optional: a tiny shared secret in `localStorage` + `X-Key` header so strangers with the URL can't wipe saves.

Notes: free tier = 100k KV reads/day, 1k writes/day (enough for a friend group); assets (Kenney CC0) and sounds
(CC0) are fine to publish; `public/assets/manifest.json` must be generated before the build (`npm run assets`).
