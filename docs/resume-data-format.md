# `resume.data.yaml` — format & authoring guide

**This is the single source of truth for the `resume.data.yaml` format.** When a
feature changes the data format, update **this file** — everything else
(CLAUDE.md, CONTEXT.md) only points here, so there is nothing else to keep in
sync. The machine-checked contract is the Zod schema in `lib/data.ts`; this doc
is the human/agent contract that also captures the rules a schema can't express
(welding, appendable clauses, "never invent facts").

Vocabulary: [CONTEXT.md](../CONTEXT.md). Design rationale:
[ADR 0004](adr/0004-fragment-based-bullet-composition.md).

---

## Rules quick-reference

1. Exactly **one** `core: true` Fragment per Bullet (zero or many → load throws).
2. The **core** carries the verb/spine and is always rendered; additives are
   freely omittable.
3. A **Fragment is an independently-omittable true statement** — dropping any
   additive must never make what remains misleading.
4. **Weld bounding qualifiers** (scope-narrowing words) into the fragment they
   bound; never a standalone additive.
5. **Additives must be cleanly-appendable clauses** — core + all additives joined
   by single spaces, in order, must read as one natural sentence.
6. **Never invent facts.** Only re-partition the Owner's own words; numbers and
   proper nouns stay verbatim.
7. **No tag fields** (`category`/`tech`/`tags`). Fragments are render-time content,
   never selection keys. (See ADR 0001 / ADR 0004.)

Everything below is the reasoning and examples behind these rules.

---

## The idea in one minute

Each accomplishment (a **Bullet**) is not one frozen sentence. You cut it into
**Fragments** — small true statements. When an HR user searches, the engine:

1. **surfaces** the Fragments relevant to their keywords and drops the rest
   (*content variety*), then
2. **rephrases** the surfaced Fragments into one sentence tuned to those keywords
   (*sentence variety*).

So the same real accomplishment reads differently for a backend role vs. a
latency role vs. a leadership role — without you writing three versions, and
without the engine ever inventing a fact.

The catch: **the engine can only surface and reword the Fragments you give it.**
If a Bullet is one big Fragment, there's nothing to surface — you get the same
sentence every time. The value lives in how you *cut*.

---

## The shape

```yaml
positions:
  - company: Acme Corp
    title: Senior Backend Engineer
    start: "2023-01"
    end: present            # a real month "YYYY-MM", or the word `present`
    location: Taipei, Taiwan
    bullets:
      - fragments:
          - text: Designed and shipped a Python API
            core: true       # the spine — exactly one per bullet, always shown
          - text: serving 2M requests/day
          - text: at p99 under 80ms
        default: true         # include in the Default Resume (see below)
```

You never write IDs — the loader assigns them (`p{p}b{b}` for Bullets,
`p{p}b{b}f{f}` for Fragments).

---

## The core Fragment

Exactly **one** Fragment per Bullet is the **core** (`core: true`). It carries
the verb and the spine of the accomplishment, and it is **always rendered**. The
others are **additives** — freely droppable emphasis.

> A Bullet with two cores, or none, fails to load with:
> `a Bullet must have exactly one core Fragment, found N`.

---

## How to cut a Bullet

Take your original sentence and ask, in order:

| Question | Goes to |
|---|---|
| What's the spine (verb + what you did)? | **core** |
| Is there an outcome or metric? | additive |
| A technical detail worth surfacing (languages, tools)? | additive |
| Any scope-*narrowing* words? (internal / intern / temporary / prototype / cleanup window) | **weld into the core** — never its own additive |

### Worked example

Original:

> Led the migration from a monolith to 6 services with zero customer downtime.

Cut:

```yaml
- fragments:
    - text: Led the migration from a monolith to 6 services
      core: true
    - text: with zero customer downtime
```

Now "with zero customer downtime" surfaces for a reliability-focused role and
drops for one that doesn't care — while "Led the migration to 6 services" always
shows.

---

## The one rule that keeps you honest

> **A Fragment must be an independently-omittable true statement. Dropping any
> additive must never make what remains sound bigger than the truth.**

The danger is *misleading by omission*. Suppose the migration was only for an
internal admin tool:

```yaml
# ❌ WRONG — scope split into its own additive
- text: Led the migration to 6 services
  core: true
- text: for an internal admin tool     # droppable → the rest now oversells
```

If the engine drops that additive, "Led the migration to 6 services" reads like a
customer-facing feat. Every word is true, but the resume now lies. **Weld the
scope into the core so it can never be dropped:**

```yaml
# ✅ CORRECT — scope welded, indivisible
- text: Led the internal-admin-tool migration to 6 services
  core: true
```

You are not trusting the engine to behave. You are cutting the fact so that
misleading is *impossible to express*. That's the whole trick.

**Rule of thumb:** if a phrase could be dropped to make you look better than
reality, it's a *bounding* qualifier — weld it. If dropping it just says *less*
(and everything left is still exactly true), it's an *additive* — split it out.

---

## The appendable-clause test

When keywords are too vague to tailor, the generator falls back to the **Default
Resume**, which joins **every** Fragment with a single space, core first, with no
AI involved. So each additive must read as a clause that appends cleanly.

Test any cut by re-joining it in order:

> "Designed and shipped a Python API" + "serving 2M requests/day" + "at p99 under
> 80ms" → *"Designed and shipped a Python API serving 2M requests/day at p99
> under 80ms."* ✅ reads as one natural sentence.

If the re-join reads broken or run-on, re-cut (reword an additive, or weld it in).

---

## `default: true`

Marks a Bullet as part of the **Default Resume** — your strongest, generally
applicable accomplishments, shown when the keywords don't clear the relevance
floor. Set it on the Bullets you'd want any reader to see.

---

## Don'ts

- ❌ Don't add tag fields (`category`, `tech`, `tags`, …). Fragments are content
  that *appears in the sentence*, never search keys. A search for ".NET" already
  works because "using .NET" is in your prose.
- ❌ Don't invent or round facts to fit a cut. Only re-partition your own words;
  numbers and names must stay verbatim.
- ❌ Don't leave every Bullet as a single core if it holds several droppable
  facts — you'll get zero content variety.
- ❌ Don't split a scope-narrowing qualifier into its own additive (see the
  honesty rule above).

---

## Validate before you commit

```bash
npm run typecheck && npm run test
```

That checks the schema logic (`lib/data.test.ts`). To validate *this* file, load
it: run `npm run dev` and open the page — a bad cut throws a readable loader error
naming the Bullet. Never commit data that fails to load.
