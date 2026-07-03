# Amazon Support Resolution Co-pilot

**Live demo → https://amazon-support-copilot.vercel.app**

> Work sample built by Nibhrit Mohanty — not official Amazon content. All policies are simulated.

An AI support co-pilot for Amazon order issues that does three things the current support bot doesn't:

1. **Understands the issue in natural language** — no dropdown templates
2. **Knows when it can and can't resolve** — explicit HIGH/MEDIUM/LOW confidence triage, no false confidence
3. **Hands off with full context** — when escalation is needed, it produces a structured brief so the human agent never starts cold and the user never repeats themselves

Built as a PM portfolio prototype. It demonstrates the triage-and-handoff capability Amazon would build natively — there is no Amazon API integration and no real order data.

## The problem

Amazon's support bot is built to deflect, not resolve. It handles templated returns fine, but the moment an issue falls outside a template — package marked delivered but never received, a third-party seller dispute — users loop through 4–7 bot flows, re-describing their problem each time, before reaching a human who has zero context about what the bot already tried.

The core failures: misplaced confidence, no triage between "I can fix this" and "this needs a human," zero context transfer at handoff, and a deliberately buried escalation path.

## The experience

The prototype mimics Amazon's actual UI (representative, no trademark art) so the integration story is visible:

1. **Your Orders** → order list, exactly where users start
2. **Order Details** → in-window orders get self-serve **Return/Cancel** buttons (no AI — templated cases get buttons, not models)
3. **Customer Service** → pick the affected order, the co-pilot chat opens with full order context auto-filled — simulating what Amazon's order API would provide
4. **Co-pilot chat** → preloaded issue chips that look like Amazon's templated options, but feed natural language into the pipeline — so "none of these match" stops being a dead end

## How the AI works

```
Order context auto-filled from the selected order + issue in plain language
        │
        ▼
CLASSIFY  → 1 of 11 issue categories + HIGH/MEDIUM/LOW confidence
        │     · never HIGH for seller disputes or account issues (hard rule)
        │     · vague input → asks ONE clarifying question, doesn't guess
        ▼
BRANCH    → HIGH + resolvable      → resolution with verbatim policy citation
            MEDIUM / partial       → partial resolution + what needs human review
            LOW / non-resolvable   → escalation brief (owner + urgency + full context)
        │
        ▼
LOOP GUARDRAIL → same issue type twice? Skip the flow, escalate immediately.
                 The product notices it's looping and changes strategy —
                 the exact opposite of the bot it replaces.
```

## The eval panel — showing the thinking

Every response carries a collapsible eval panel scoring five dimensions, each tagged with its verdict source:

| Dimension | Scored by | How |
|---|---|---|
| Classification accuracy | **User** | "Yes this is my issue" confirmation — the user is the only runtime ground truth |
| Confidence calibration | Code, then LLM judge | Hard rules in code; nuance judged by a second model |
| Resolution quality | **Code** | Cited policy must exist; quote must be a *verbatim substring* of the policy text; AI can't exceed the policy's resolution authority |
| Brief completeness | **Code** | Every field a human agent needs, present |
| Hallucination | Code, then LLM judge | Fake citations caught mechanically; invented user facts caught by the judge |

The principle: **use code where code is trustworthy, a judge model only where judgment is needed.**

## Stack

- **Frontend:** React + Tailwind CSS, single page
- **AI:** Claude API (`claude-sonnet-4-6` for product prompts, `claude-haiku-4-5` for the eval judge) with forced tool-use for guaranteed structured JSON
- **Backend:** one Vercel serverless function (`/api/claude`) — a thin proxy that keeps the API key server-side so the public link is safely shareable
- **Policy data:** 14 mocked policies (`src/data/policies.json`) fed as system-prompt context; every citation carries "(simulated policy — verify at amazon.in)"

## Run locally

```bash
npm install
cp .env.example .env   # add your Anthropic API key
npm run dev            # serves the app AND the api function via a dev bridge
```

Eval harness (runs the real prompts against 8 test cases):

```bash
node evals/run_evals.mjs        # classification checks
node evals/run_evals.mjs --full # + resolution, brief, and LLM-judge checks
```
