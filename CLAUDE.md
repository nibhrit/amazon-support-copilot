# Amazon Support Resolution Co-pilot — Claude Code Instructions

## What this project is

A portfolio prototype demonstrating an AI support co-pilot for Amazon order issues — natural-language issue intake, confidence-based triage (resolve vs escalate), and structured escalation briefs so human agents never start cold. Built for Amazon shoppers in India (18–35) stuck in the current bot's deflection loops.

Built by Nibhrit Mohanty (MBA, IIM Mumbai / former PayPal SDE) as a PM interview portfolio piece.

**What it is NOT:** Not a live integration. No Amazon API, no real order data. This demonstrates the triage-and-handoff capability Amazon would build natively. All policies are mocked and carry a "(simulated policy — verify at amazon.in)" disclaimer.

---

## Stack (per PRD Section 10)

| Layer | Choice | Reason |
|-------|--------|--------|
| LLM | Claude API — claude-sonnet-4-6 via Anthropic SDK | Structured output + calibrated confidence reasoning |
| Frontend | React + Tailwind CSS, single page, no routing | PRD-specified; fast portfolio build |
| Backend | Vercel serverless function (`/api/claude`) as thin proxy | Keeps API key server-side; public link stays safely shareable. Input caps in the function + spend limit in Anthropic console bound abuse risk. |
| Policy data | Mocked JSON file (10–15 policies, specific and realistic) | Fed as system-prompt context, not user turn |
| Hosting | Vercel (free tier, shareable link) | |

---

## Folder structure

```
Amazon Support/
├── CLAUDE.md
├── src/                # React app (components, AI layer, policy data)
│   └── data/policies.json
├── evals/              # test set + eval logic
├── learnings/          # one stepN_*.md doc per build step (gitignored — local only)
├── docs/               # interview-prep artifacts (gitignored — local only)
└── README.md
```

---

## AI contract — do not change without flagging

Three prompts, all returning structured JSON:

1. **Classifier** — input: NL issue + order context → `{category, confidence, reasoning}`
   - Categories (11): standard return within window; standard refund (item returned); delivery delay (est. date not passed); item not delivered but marked delivered; wrong item received; damaged item; third-party seller dispute; account suspension / payment issue; item outside return window; subscription / Prime billing issue; unclear (ask one clarifying question)
   - Confidence: HIGH / MEDIUM / LOW. Never HIGH for third-party seller or account-level issues. Unusual keywords → default MEDIUM. Vague input → ask one clarifying question before classifying.
2. **Resolution** — input: classified issue + policy JSON → `{resolution_steps, policy_cited, next_steps}`
   - Only cite information present in the policy data. Never invent order details.
3. **Escalation brief** — input: full context → `{brief_structured, suggested_owner, urgency}`
   - Owner: Returns team / Seller disputes / Account team. Urgency: Standard / Time-sensitive / High-value order. No invented info.

Branching: HIGH + resolvable → resolution with policy citation. MEDIUM / partially resolvable → partial resolution + flag what needs human review. LOW / non-resolvable → acknowledge + escalation brief.

**Loop guardrail:** same issue type submitted twice → skip re-classification, go straight to escalation brief (simple useState counter).

---

## Scope — v1 (MVP)

**In scope:**
- Web app (desktop + mobile responsive), **Amazon-shell UI**: Your Orders → Order Details (contextual self-serve Return/Cancel for in-window orders, mock confirmation only) → Customer Service order picker → co-pilot chat
- Co-pilot chat: preloaded issue chips + NL free text; order context auto-filled from the selected mock order (`orders.json`, relative dates so windows never expire) — simulates the Amazon order API
- AI classification, confidence indicator on every response
- Policy-backed resolution with citation, OR escalation brief
- Human review layer: user confirms "yes this is my issue" / re-describes (prior context retained); chat sessions retained per order
- **Eval panel visible in the UI** — collapsible on every response: classification label, confidence, eval dimensions pass/fail
- No Amazon logo/trademark art — layout and palette are representative only

**Explicitly out of scope for v1:**
- Real Amazon API / order data
- Connecting to a live agent
- Multi-turn memory across sessions
- Voice interface, regional languages

---

## Eval standard

Rubric (per PRD Section 7), scored per response:
- Classification accuracy — correct issue type?
- Confidence calibration — stated confidence appropriate?
- Resolution quality — steps actionable and policy-backed?
- Brief completeness — all context a human needs?
- Hallucination rate — invented anything not in user input?

**Primary metric:** first-contact resolution rate (real Amazon OKR). Portfolio measurement: 5 real users, record 3 breaks → fix 2 → document the delta.

Eval panel scoring is **hybrid**: deterministic code checks where reliable (policy citation exists in policies.json, brief has all required fields, disclaimer present), plus one lightweight LLM-as-judge call for subjective dimensions (confidence calibration, hallucination). Rationale: use code where code is trustworthy, a judge model only where judgment is needed.

---

## Working style — follow in every session

1. **One layer at a time.** Policy data → AI layer → UI. Verify each before the next.
2. **Explain after every component.** What it does and why — Nibhrit owns every layer for interviews.
3. **Flag product decisions explicitly.** Name the decision and the reasoning.
4. **Features discussion before code.** Confirm new features before implementing.
5. **Verify locally before declaring done.** Run it, observe real output.
6. **Write a learnings doc after every step** in `learnings/` (`stepN_short_name.md`). Permanent requirement.

---

## Conventions

- Commit messages: short and to the point. No co-author / generated-with trailers.
- Never hardcode secrets — env vars only; gitignore `.env` and `.claude/`.
- Gitignore `learnings/` and `docs/` — local only, never pushed, not linked from README.
- Disclaimer strip on frontend: "Work sample built by Nibhrit Mohanty — Not official Amazon content."
- Every policy citation carries "(simulated policy — verify at amazon.in)".
- Branch/commit/push only when asked.
