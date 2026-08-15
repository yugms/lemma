# Seeding the problem pool

`npm run seed` stocks the shared pool offline, so builds can fill slots for free. See the [README](../README.md) for what lemma is.

## Why

A build fills up to half of every ordinary set from already-verified `problems` rows, and those slots cost nothing — no model call, no daily quota. Today the pool only grows as a side effect of builds that already paid for it. This stocks it deliberately: the authoring and the checking are done by whoever runs the tool, not by the provider, so every set that reuses a seeded problem is cheaper for good.

Two things it does not do. It does not help **targeted or material sets** — those skip pool reuse by design and pay the AI cost for every slot. And it writes no `drill` you couldn't have had for free: 16 deterministic templates already serve that style, so the cells worth your own time are the non-drill ones the census marks thin.

## By hand

Three steps, with a file between each:

```bash
npm run seed -- census                       # what the pool holds, per topic and difficulty
npm run seed -- plan --topics multi-step-linear --difficulty 3 --count 12 \
                     --styles word,conceptual --formats mcq,open
# author .seed/authored.json from .seed/authoring-brief.md
npm run seed -- solve                        # writes the statements, with no answers
# solve them into .seed/solved.json
npm run seed -- ingest [--dry-run]           # gates them, writes what passes as `active`
```

The briefs are assembled from `GENERATOR_SYSTEM_PROMPT`, `buildUserMessage` and `solverPrompt` — the same code paths the live pipeline uses — and `ingest` runs `structuralCheck` and `solverGates`, not a copy of them. A seeded problem clears exactly the bar a generated one clears.

> [!IMPORTANT]
> **Solve in a context that has not seen the answers.** `.seed/authored.json` holds the key, the worked solution and the distractor rationales, and the solve step exists to disagree with them. Run it fresh — it needs no database and no key, which is what makes that easy. Solving in the session that authored the batch produces a verified stamp on an unverified problem, and nothing downstream re-checks it.

`.seed/` is gitignored, deliberately rather than incidentally: between `plan` and `ingest` it holds answer keys for problems about to be served.

`ingest` refuses to pair solutions onto a batch that has changed since `solve` ran. Editing `authored.json` between the two steps is expected — the tool tells you to — but deleting a problem from the middle renumbers everything after it, and every result would still land in range while each problem was judged against its neighbour's answer. Re-run `solve` and the new brief.

## Unattended

`auto` is the same three steps in a loop, with `claude -p` in the author's chair. Start it, leave it running for as long as you like, stop it whenever:

```powershell
npm run seed -- auto --forever --jobs 2 *> .seed/auto.log   # its own terminal, or detached
npm run seed -- stop                                        # from any window, whenever you're done
```

It needs the `claude` CLI on `PATH` and signs in however that CLI already does. Nothing about the pipeline changes: the same briefs, the same `structuralCheck` and `solverGates`, the same `insertProblems`.

`--jobs` is how fast it goes and also how quickly it runs into your subscription's rate limit, which shows up as cells timing out rather than as an error — 2 or 3 alongside your own Claude Code session is about right.

Each round it re-censuses the pool, ranks the (topic, difficulty) cells it is thinnest at, and works down them thinnest first. Once every cell has reached `--target`, it raises the target and goes round again — so it deepens the whole catalog evenly rather than ever declaring itself finished.

### Stopping

`stop` writes a file the loop checks before each cell, so it finishes what it is holding and exits cleanly; it exists because a run in another window has no Ctrl-C to receive. Ctrl-C does the same thing when you have one, and a second one quits immediately and takes the subprocesses with it.

It also stops itself if something is actually broken: three cells in a row that author nothing at all (no `claude` on `PATH`, a subscription that has stopped answering) end the run, while ten in a row that author fine and have everything rejected are tolerated first — that is a hard patch of the catalog, not a broken tool.

### Coverage

**Systematic rather than exhaustive per batch.** A cell is one topic at one difficulty; each visit asks for a rotating slice of the styles and formats, because a dozen problems spread over four styles and eight formats is one or two of each at the worst possible request count. Depth is still measured over the *whole* requested vocabulary, so a cell keeps coming back until it is stocked across all of it. `drill` is left out by default.

### Who checks the work

Two flags, deliberately not one, because they are not the same trade.

**`--verify` decides who re-solves each batch.** `gemini` (the default) uses `solveBatch` — the pipeline's own solver, a different model that never sees the workspace, at roughly three requests per twelve problems. `claude` spends no provider quota at all and is weaker: an author and a solver that are the same model share their blind spots, which is the same objection that makes Gemini-writes-Gemini-checks worth distrusting in the first place. The isolation there is a directory holding the statements and nothing else, plus a brief that says so — not a sandbox.

**`--equivalence` decides who settles a prose answer.** Local comparison can never do better than "uncertain" on text, which is every `proof`, `conceptual` and `error_analysis` problem — three of the four styles `auto` writes by default. `ai` (the default) spends one provider call. `claude` asks a subprocess. `defer` writes the question out for a person, and in an unattended run that means *dropping* every one of those problems.

> [!TIP]
> `--equivalence claude` is much the softer of the two substitutions. The blind solve has to be a stranger — it exists to disagree. Equivalence takes both answers as its input, so it was never blind to begin with, and what it asks is a language question ("do these two phrasings say the same thing?") rather than a second opinion on the maths.

So a run that never touches the provider is:

```bash
npm run seed -- auto --verify claude --equivalence claude
```

...and it keeps all four styles, where `--equivalence defer` would leave you only `word`.

The requests `gemini` verification costs are worth putting next to what they buy: a pool problem is authored once and reused for as long as it lives, against the five requests a build spends every time it has to write one from scratch.

One asymmetry between them is worth knowing, because it looked like a Claude failure and wasn't. `SolverResultSchema` marks eleven fields nullable and none optional, so a result has to carry `chosen_pairs`, `chosen_curve` and six others even on a problem where they mean nothing. Gemini cannot leave one out — the structured-output API constrains what it writes — but a checker writing the file by hand reasonably omits them, and the whole batch was then rejected over blank fields rather than a wrong answer. `fillOmittedNulls` supplies them at read time, on the same principle as `stamped()`: what the reader can fill in, it fills in rather than asking for and then complaining about. It only fills fields that are *absent*, and the fields that say whether a solve happened at all — the answer, `is_well_posed`, `problem_number` — aren't nullable, so they can't be filled and a result missing one still fails.

### Which Claude

`--model` sets the model for both subprocesses; `--author-model` and `--check-model` override it for one each. Unset, they inherit whatever the `claude` CLI is configured to use.

Splitting them is worth it because the two jobs aren't the same difficulty. Writing a good problem from nothing is the expensive half and the one worth a large model. Re-solving a stated problem, and comparing two answers, are ordinary work — a smaller model does them faster and cheaper:

```bash
npm run seed -- auto --author-model opus --check-model haiku --verify claude --equivalence claude
```

That also buys back a little of what `--verify claude` gives up, since two models that were trained differently fail in somewhat different places. Only a little: same family, related training, nothing like the independence `--verify gemini` gets structurally.

### How a prose answer actually gets settled

Worth knowing because it decides what a failure costs. The batch is judged once with every prose pair left open, all the open pairs go to one subprocess together — not one each, which would cost more wall clock than the authoring did — and then the batch is judged again with the answers folded in. Re-judging is free: the gates make no model call of their own.

Every way that can go wrong ends in *fewer answers*, never wrong ones. A subprocess that dies, writes nothing, writes malformed JSON, or invents a key it was never asked about contributes nothing for those pairs, and a pair left unanswered stays unjudged and drops its problem — exactly what `defer` does. There is no path through it that is worse than not having asked.

### What the subprocess gets

`Read`, `Write` and `Edit` — no shell — started inside the cell's own directory, and **none of your keys**. The run itself needs `SUPABASE_SECRET_KEY` and `GEMINI_API_KEY`; the author and the checker write a JSON file and need neither, so `childEnv` strips anything credential-named (and anything whose *value* carries a credential, which is how a `DATABASE_URL` hides one) out of what they inherit, leaving only what `claude` uses to sign in.

### What to expect

Four to seven minutes per cell, nearly all of it authoring — the exotic formats (`ordering`, `matching`, `multi_select`) run noticeably slower than `mcq` and `open`. Expect a real rejection rate too: the gates reject on genuine disagreement, and they reject more at difficulty 4 than at 2.

Stopping is always safe: a cell is written before the next one starts, the ranking is deterministic, and a successful cell's workspace is swept so the answer keys don't pile up. What stays under `.seed/auto/` is the cells that failed, which are the only ones worth opening.
