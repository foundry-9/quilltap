---
url: /salon
---

# Mathematical Notation

> **[Open this page in Quilltap](/salon)**

Should your conversations turn toward the quantitative — a spot of calculus over cocktails, an equation or two between chapters — the Salon is fully equipped to typeset mathematics with all the crispness of a printed monograph. The machinery beneath is KaTeX, a typesetting engine of considerable pedigree, and it operates without any fuss on your part.

## Writing Mathematics

Mathematics arrives in two fashions: *inline*, nestled within a sentence, and *display*, set apart on its own line with room to breathe.

### Inline Mathematics

Wrap a LaTeX expression in double dollar signs, or in backslashed parentheses:

- `$$e^{i\pi} + 1 = 0$$` — double dollars
- `\(e^{i\pi} + 1 = 0\)` — backslashed parentheses

Either way, the expression takes its place mid-sentence, as neatly as a monocle in a waistcoat pocket.

### Display Mathematics

For an equation deserving of its own stage, place double dollar signs on their own lines, or use backslashed square brackets:

```
$$
\int_0^\infty e^{-x^2}\,dx = \frac{\sqrt{\pi}}{2}
$$
```

or

```
\[
\sum_{n=1}^\infty \frac{1}{n^2} = \frac{\pi^2}{6}
\]
```

Display equations are centred and generously spaced; should one prove wider than the room allows, it politely scrolls sideways rather than elbowing the furniture about.

## A Note on Dollar Signs

You may have encountered establishments where a *single* dollar sign summons mathematics. The Salon treads carefully here. Writers deal in dollars rather more often than in differentials — "He slid $50 across the table, then another $20 for luck" — and it would be a poor show indeed for a character's gambling debts to arrive typeset as an equation.

So the Salon employs a discreet doorman. A single-dollar expression is admitted as mathematics **only** when its contents are unmistakably mathematical — a backslashed command such as `\pi` or `\mathcal{P}`, a subscript or superscript, or a pair of braces. Anything without such credentials — a plain sum of money, a lone letter — is waved through as ordinary prose and left exactly as written. This spares the well-behaved models, which reach for single dollars by long habit, while your gambling debts stay solvent.

A bare single letter, `$K$`, carries no mathematical credentials of its own. Standing quite alone in a sentence it remains plain text — but should a properly credentialed expression appear elsewhere on the same line, the doorman infers good company and admits the bare letter too, so that `$K$` and `$\mathcal{P}$` may be introduced together in one breath. A lone letter with no such companion, or when you simply wish to be certain, is best written `$$K$$` (or given credentials of its own, as in `$K_1$`); the double-dollar `$$` and backslashed forms above are never in doubt.

## Where Mathematics Renders

- **The Salon** — messages from you and from characters alike, including streamed responses as they arrive
- **Help documents** — such as this very page: \(a^2 + b^2 = c^2\)
- **File previews** — Markdown documents opened from the Scriptorium or your project files

Code blocks and inline code are exempt, naturally — a dollar sign in a snippet of source code stays exactly as typed.

## When the Ink Smudges

If an expression contains an error KaTeX cannot forgive — an unclosed brace, an unknown command — the offending fragment is shown in red, in its raw form, so you may inspect and repair it. The rest of the message renders unperturbed.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon")`

## Related Pages

- [Chats Overview](chats.md) — The Salon and its workings
- [Message Actions](chat-message-actions.md) — Edit, regenerate, and manage messages
- [File Previews](file-search-preview.md) — Viewing documents and files
