# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Supabase API keys

The app reads its Supabase credentials from `.env` at build time:

| Variable | Notes |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | New-format key, `sb_publishable_…` — **preferred** |
| `VITE_SUPABASE_ANON_KEY` | Legacy JWT key, used only as a fallback |

### "Legacy API keys are disabled"

Supabase replaced the JWT-based `anon` / `service_role` keys with new-format
`sb_publishable_…` / `sb_secret_…` keys. When a project has legacy keys turned
off (Dashboard → **Settings → API Keys → Legacy API keys**), every request made
with the old `anon` JWT is rejected — which shows up as this error on the
register and login screens.

To fix:

1. Supabase Dashboard → **Settings → API Keys** → copy the **Publishable key**.
2. Put it in `.env` as `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…`.
3. Rebuild — `npm run build`, then `npx cap sync android` for the APK. The keys
   are inlined at build time, so restarting the app is not enough.

The edge functions (`send-sos-notification`, `send-message-notification`) need no
code change: each one authorises its caller by exact-matching the bearer token
against the `SUPABASE_SERVICE_ROLE_KEY` in its own environment, falling back to a
JWT check, so legacy and `sb_secret_…` keys both work. If those functions start
rejecting calls after the key change, the database webhook is still sending the
old key — update its `Authorization: Bearer …` header to the key the function
now has.
