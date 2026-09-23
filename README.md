# Sold

Take a photo of something you want to sell. Sold identifies it, prices it from live comps with real URLs, drafts the listing, publishes after you approve, and drafts buyer replies behind your floor.

## Stack

- Next.js App Router + React + Tailwind
- Supabase Auth (required in production)
- LangGraph agents: vision → comps → listing copy → publish → negotiate
- Browserbase for marketplace sessions (optional; local Chrome fallback where configured)
- SQLite for app data (`node:sqlite`), with Netlify-friendly cloud DB helpers when hosted

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment

Required for agents (either provider works):

```
OPENAI_API_KEY=
# or
ANTHROPIC_API_KEY=
```

Required for production auth:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Apply `supabase/migrations/20260923043318_sold_auth_profiles.sql` in your Supabase project.

Optional integrations:

```
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=
COMPOSIO_API_KEY=
COMPOSIO_USER_ID=
COMPOSIO_NOTIFY_EMAIL=
```

Without Supabase env vars, local mode falls back to a single demo seller id so you can still exercise the agents. With Supabase configured, API routes and app pages require sign-in.

## Product rules

- No invented ask price without live comps that have public listing URLs
- Nothing posts until you approve
- Negotiator drafts stay behind your floor; nothing auto-sends
- Marketplace passwords never pass through Sold (Browserbase/local sessions only)

## Scripts

```bash
npm run build
npm run test:pricing
npm run test:marketplace
```

## Deploy

Netlify build uses `npm run build` (see `netlify.toml`). Set the same env vars in the host. After deploy, confirm Sign in works and Image/agent keys are present.
