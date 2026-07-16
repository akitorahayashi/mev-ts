---
name: clarifying-questions
description: Draft only the questions research cannot answer, for the user to relay to another expert. Trigger only when the user explicitly invokes the question skill by saying 「質問スキルを使って」 or "use the question skill".
---

# Clarifying Questions

Turn open uncertainty into a short list of questions worth another person's time: only what cannot be resolved from available material, written so the recipient answers without re-explaining what is already known.

## Ask only what is not already answered

By the time this skill runs, the task has usually already been investigated in the conversation. Reuse what is known; do not re-investigate it. A point becomes a question only if it is not answerable from what has already been gathered (code, docs, specs, PRs, tickets, prior findings). Investigate further only to close a genuine gap none of that covers, never to repeat work already done.

## Triage every uncertainty

Sort each open point; only the last becomes a question.

- Resolvable by investigation: resolve it now. Record the fact in working notes, not in the question file.
- Safe to assume: state it as an explicit assumption in the spec/design to confirm at review. Do not ask.
- Genuine blocker (needs a decision, or knowledge only a person holds): ask.

## Write for the reader

Each question is self-contained.

- Order by what blocks the most.
- Background: why it is asked, what was already checked (show the research so they do not repeat it), and which part of the work is blocked without the answer.
- Ask: specific, answerable sub-points.
- Inline the context the recipient needs. Do not reference internal working files they cannot open; external or shared references (shared repos, tickets, design files) are fine.

## Keep the file declarative

The file holds only currently-open questions, describing the present set of blockers.

- Lead with a shared context/前提 section so questions do not repeat common background.
- Answered question: remove it; move the resolved fact to working notes.
- Partial lead from investigation: fold it into the background and narrow the ask.
- No changelog or history.
- Match the recipients' language.
- Spell out abbreviations the recipient may not share.

## Template

Follow the [template](assets/template.md), translating its headings and labels into the recipients' language.
