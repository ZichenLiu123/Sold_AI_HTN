# Sold

Photograph something you want to sell. Sold writes the listing, checks real sold comps, and lets a Negotiator Agent handle the buyer.

Built as a 36-hour hackathon demo. One hardcoded seller (`Alex`). No auth, no payments, no shipping.

## Stack

- Next.js + React + Tailwind
- LangGraph (`vision_extract → comp_search → generate_listing`)
- GPT-4o or Claude for vision + listing copy + negotiation
- Browserbase for sold-comp search and persistent marketplace seller sessions
- Composio for an optional Gmail listing receipt
- SQLite via Node’s built-in `node:sqlite`

## Setup

```bash
cp .env.example .env.local
```

Required for the three real agents (either one):

```
OPENAI_API_KEY=...
```

or

```
ANTHROPIC_API_KEY=...
```

Optional, but this is how you claim the live integrations:

```
BROWSERBASE_API_KEY=...
BROWSERBASE_PROJECT_ID=...
COMPOSIO_API_KEY=...
COMPOSIO_USER_ID=sold-demo
COMPOSIO_NOTIFY_EMAIL=you@email.com
```

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Demo path

1. **New listing** — upload a photo of a real object. Optional hints help; the photo leads.
2. Watch the pipeline stamp through **vision → comps → copy**.
3. Open **Accounts**, connect each marketplace, and sign in/complete 2FA directly
   in the Browserbase live session. Return to Sold and click **Check login**.
4. Set a **floor price** (never shown to the buyer). **Approve & publish**
   authorizes automation only for selected, verified connections. Challenges or
   ambiguous required fields pause with an **Open session** action.
5. In the mock inbox, send as the buyer:
   - a question → `ANSWER`
   - a mid offer → `COUNTER`
   - a lowball → `HOLD`
   - asking price → `ACCEPT`
   - overpay + refund shipping → `ESCALATE`
6. Each agent reply is stamped with the action. That’s the judge shot.

If Browserbase isn’t configured, comps fall back to an estimate and the UI says so. Listing copy and negotiation still run on Claude.

Marketplace passwords and authentication artifacts never pass through Sold.
SQLite stores only Browserbase context/session IDs and safe login evidence.
This demo deliberately scopes every connection to `demo-seller`; production
must add real authentication, per-user authorization, and encryption at rest.
