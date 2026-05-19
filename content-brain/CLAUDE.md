# Content Brain — Operating Manual

This folder is the user's personal Obsidian vault of scraped Instagram creators **plus their own reels**. It powers an ideation pipeline:

1. Each studied creator gets `Patterns.md` (how they win) + `Playbook.md` (steal the structures)
2. The user's own scrape gets `Voice.md` (so Claude knows how the user sounds)
3. When the user ideates or drafts, Claude pulls from **all the Patterns + their Voice** to suggest reels in their voice using proven structures

The user adds creators through the local webapp's **+ Add creator** button (or the Python CLI scripts under the repo root). That auto-writes `videos/<shortCode>.md`, `all.md`, `all.html`, `Dashboard.md`, tags every reel, and updates `_Home.md`. **`Patterns.md`, `Playbook.md`, and `Voice.md` are written by Claude in chat** — that's how we keep quality high (free-tier Groq LLMs gave shallow output, so the analysis step is intentionally manual).

---

## Trigger 1 — "analyze \<account\>" / "study \<account\>'s patterns"

Default for creators the user is studying.

1. Read `<account>/all.md` thoroughly. Captions, metrics, transcripts. Don't skim.
2. Write `<account>/Patterns.md` with concrete observations. Quality bar:
   - Reference reels by view count ("her 660k-view resume reel")
   - Quote actual hooks/CTAs verbatim
   - Compare top performers vs flops with real numbers
   - If a pattern appears once, it's an anecdote — say so
   - Cover: **Hook formula(s)**, **Structure** (beats/duration/named-step pattern), **What kills reels** (with examples), **CTA mechanics**, **Caption format**, **Voice/language tics**, **Topic patterns**, **Anything counterintuitive**
   - End with **TL;DR for stealing** — 5-7 bullets
3. Write `<account>/Playbook.md` — a checklist for the user to write their own reels using this creator's structures:
   - Topic selection rule (`[Tool] × [Pain use case]` template)
   - Hook templates with `[FILL-IN]` slots
   - Beat-by-beat script with target durations
   - Caption template with placeholder bullets
   - Always-on secondary CTA pattern
   - Pre-publish checklist (checkbox bullets)
   - Anti-patterns (specific to this creator's flops)
   - One-sentence TL;DR
4. **Use `[[shortCode]]` wikilinks** when referencing specific reels (e.g. `[[DX-GNTnTEeF]]`). That makes Patterns a hub in the graph view.

Both files must have YAML frontmatter:
```yaml
---
account: <username>
type: patterns  # or playbook
generated: <today>
reels_analyzed: <count>
tags:
  - type/patterns  # or type/playbook
  - account/<username>
---
```

Gold-standard reference: `cindiezhu/Patterns.md` and `cindiezhu/Playbook.md`. Match that depth.

---

## Trigger 2 — "analyze me" / "this is my account" / "write my Voice"

When the scraped account is the user themselves, write `<self>/Voice.md` instead of Patterns/Playbook. This is the user's style DNA for drafting later.

`Voice.md` captures:
- **Sentence rhythm**: short staccato? long flowing? mixed? With examples.
- **Recurring phrases / tics**: the user's equivalent of "did you know" — quote them verbatim
- **Vocabulary**: formal/casual, jargon level, swear-comfort, emoji-comfort
- **Opening + closing moves**: how they hook, how they end
- **Topic frequency**: what they cover, what they avoid
- **Tone**: enthusiastic / dry / authoritative / playful / sarcastic — one word with evidence
- **Differentiators**: what makes their voice unmistakable

Frontmatter:
```yaml
---
account: <username>
type: voice
generated: <today>
tags:
  - type/voice
  - account/<username>
  - self
---
```

---

## Trigger 3 — "ideate" / "give me reel ideas" / "what should I post"

1. Read every `<account>/Patterns.md` in the vault (for hook + structure inspiration)
2. Read the user's `<self>/Voice.md` (to stay in their voice)
3. Output **3-5 ideas**. Each idea = `{topic, hook line in user's voice, 3-bullet content sketch, CTA keyword, predicted hook source (which creator's formula)}`
4. Do not copy a creator's idea verbatim. Synthesize across multiple Patterns files. The user wants new angles that *use* proven structures.

---

## Trigger 4 — "draft a script for: \<idea\>" / "write a reel about \<x\>"

1. Pick the creator whose Playbook is the closest structural fit. State which and why in one line.
2. Read that creator's `Playbook.md` + the user's `Voice.md`.
3. Output the script in this shape:
   - **HOOK** (target ~5s, in user's voice)
   - **STEPS** (numbered "Number 1...", 4-5 of them, each one specific tool/setting/move)
   - **WRAP** (3-5 word memorable phrase)
   - **VERBAL CTA** (single-word comment trigger)
   - **CAPTION** (full template: hook line + emoji bullets + wrap + CTA + community plug + hashtags)
4. Constrain total VO target to 50-75 seconds. Estimate WPM ~140; cut if over.
5. Write as the user would say it — their tics, sentence length, vocabulary.

---

## Trigger 5 — "compare \<a\> and \<b\>" / "what's working across all accounts"

Write to `_meta/<a>_vs_<b>.md` or `_meta/cross_account_patterns.md`:
- **Shared patterns** (formula intersection) — what's universal
- **Divergences** — where they differ deliberately; what each is betting on
- **Unique moves** — what each does that nobody else does
- **Synthesis recommendation** — what to steal from each, given the user's Voice

---

## File layout

```
content-brain/
├── CLAUDE.md                ← this file
├── _Home.md                 ← auto-generated MOC, every account linked
├── _meta/                   ← cross-account analyses (Claude writes here)
│   └── cross_account_patterns.md
├── cindiezhu/               ← one folder per scraped account
│   ├── all.md               ← Claude reads this for analysis
│   ├── all.html
│   ├── Dashboard.md         ← Dataview queries, auto-generated
│   ├── Patterns.md          ← Claude writes
│   ├── Playbook.md          ← Claude writes
│   ├── _apify_raw.json
│   └── videos/<shortCode>.md (one per reel, fully tagged)
└── <self_username>/         ← the user's own scraped account
    ├── Voice.md             ← Claude writes (style DNA)
    └── (everything else same as a creator)
```

The graph view connects nodes via:
- **Wikilinks** in Patterns/Playbook/Voice → per-reel files
- **Tags** in every reel: `account/<x>`, `performance/<top|mid|low>`, `duration/<short|medium|long>`, `topic/<hashtag>`
- **Type tags**: `type/patterns`, `type/playbook`, `type/voice`, `type/MOC`

---

## Anti-patterns when writing analysis

- Generic best-practice statements ("the creator uses a hook to grab attention") — useless, every reel does that
- Corporate buzzwords ("leverage synergies", "drive engagement")
- Calling a single occurrence a "pattern"
- Summarizing captions instead of extracting formulas
- Padding length without adding signal
- Ignoring the user's Voice when drafting scripts

---

## Sanity check before responding

When the user says any of the triggers above, verify:
- [ ] Did I read the right file(s)? (all.md for analysis; Patterns.md for ideation; Playbook.md + Voice.md for drafting)
- [ ] Are reel references wikilinked (`[[shortCode]]`)?
- [ ] Does the output have YAML frontmatter with tags?
- [ ] Does it match the depth of the cindiezhu gold standard?
- [ ] For drafts: is it in the user's Voice, not the creator's?
