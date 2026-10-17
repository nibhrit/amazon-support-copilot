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
Customer message + order details (auto-attached from the selected order)
        │
        ▼
UNDERSTAND → what the message is doing (new issue, follow-up, asking for a person, thanks)
             + 1 of 11 problem types + HIGH/MEDIUM/LOW confidence
             · confidence capped in code: never HIGH for seller, account or billing
               issues, or on any third-party-seller order
             · too vague → ONE clarifying question, never a guess
        │
        ▼
DECIDE     → must a person decide?  → escalation brief (owner + urgency + full context)
               (asked for a person · human-only policy or issue type · LOW confidence ·
                same problem again · "this didn't solve it")
             otherwise              → steps backed by a word-for-word policy quote
        │
        ▼
SAFETY     → account and payment handoffs always show
             "Amazon never asks for your OTP or password. Don't share it."
```

The rules on who decides are enforced in code, not left to the prompt: the product notices when it is looping, or when a policy says only a person may decide, and changes course.

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

## How it was tested

47 test cases: all 11 problem types, plus Hinglish, text-speak typos, two problems in one message, prompt-injection attempts and an "I want to talk to someone" conversation. 17 are **held out**: never used while fixing, run once at the end.

| Round | Result |
|---|---|
| First full test (21 practice cases) | 10 / 21 passed |
| After 7 fixes (the 11 failures re-run) | 9 / 11 now pass |
| **Held-out test (17 untouched cases)** | **15 / 17 passed** |

A small sample: 15 / 17 means the true pass rate is probably above 64% (95% confidence). The fixes came straight from the failures: a human-only policy that got self-serve steps, a request for a person that was forgotten, a missing security warning, an AI judge that contradicted its own reasoning. The whole test programme ran on about $1.50 of API credit, with every run priced in advance and capped in code.

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

Requires Node 22 (`nvm use` reads `.nvmrc`).

Eval harness (runs the app's real routing against `evals/cases_v2.json`):

```bash
node evals/run_evals_v2.mjs --mock                     # free: stand-in AI, checks the routing logic
node evals/run_evals_v2.mjs --estimate --split all     # free: exact token count → projected cost
node evals/run_evals_v2.mjs --split dev --budget 0.75  # real run; stops before the dollar cap
```

The original 8-case harness (`evals/run_evals.mjs`) is kept for reference.
