/**
 * Effect expressions — the one string grammar in Pascal's format.
 *
 * An effect's `value` may be an expression: arithmetic, string concatenation,
 * parentheses, literals, and `{{ref}}` substitution. That is the whole
 * language. There are **no identifiers, no function calls, no member access** —
 * the only names the grammar admits are the same `{{...}}` reference families
 * `renderTemplate` already substitutes (`value`, `roll`, `dice`, `llm`,
 * `params.x`, `metadata.key`, `state.path`), so there is still nothing callable
 * and nothing reachable beyond the run's own subjects. No `eval`, no
 * `Function`: a hand-rolled tokenizer, a recursive-descent parser, and a tree
 * walk.
 *
 * Failure semantics (normative, see the feature spec):
 * - **Parse failure is a load-time rejection** — syntax errors are typos, and
 *   the Workbench and discovery both catch them before a run exists.
 * - **Eval failure is fail-soft at run time** — the effect is skipped with a
 *   debug log; a broken effect never sinks a roll.
 *
 * Pure and client-safe: no logging, no I/O, no imports. The Workbench runs the
 * parser in the browser for its warning pass.
 */

export type ExprValue = number | string | boolean;

/** Cap on an effect expression's source text, in characters. */
export const MAX_EFFECT_EXPRESSION_LENGTH = 500;

/** Cap on an expression's token count — no author needs a 65-token formula. */
export const MAX_EFFECT_EXPRESSION_TOKENS = 64;

/** Cap on parenthesis nesting depth. */
export const MAX_EFFECT_EXPRESSION_DEPTH = 8;

/**
 * Render a number for display: integers plain, floats to 4 significant digits.
 * The template convention — `{{value}}` in an outcome message and a number
 * concatenated in an effect expression must read identically.
 */
export function formatValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  // `toPrecision` can hand back exponential form for extremes; Number() folds
  // that back to the shortest faithful representation.
  return String(Number(value.toPrecision(4)));
}

/** The parsed tree. Closed by construction: four node kinds and nothing else. */
type ExprNode =
  | { kind: 'literal'; value: ExprValue }
  | { kind: 'ref'; name: string }
  | { kind: 'negate'; operand: ExprNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: ExprNode; right: ExprNode };

/** A successfully parsed expression, ready to evaluate. */
export interface ParsedExpression {
  root: ExprNode;
  /** Every `{{ref}}` the expression names, in first-appearance order, deduplicated. */
  refs: string[];
  /** The source text, for records and messages. */
  source: string;
}

export type ParseExpressionResult =
  | { ok: true; expr: ParsedExpression }
  | { ok: false; reason: string };

export type EvaluateExpressionResult =
  | { ok: true; value: ExprValue }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'ref'; name: string }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

/** The reference families the grammar admits — `renderTemplate`'s, verbatim. */
function isKnownRef(name: string): boolean {
  if (name === 'value' || name === 'roll' || name === 'dice' || name === 'llm') return true;
  for (const prefix of ['params.', 'metadata.', 'state.']) {
    if (name.startsWith(prefix) && name.length > prefix.length) return true;
  }
  return false;
}

class ExpressionError extends Error {}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const fail = (reason: string): never => {
    throw new ExpressionError(reason);
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', op: ch });
      i += 1;
      continue;
    }

    if (ch === '{') {
      if (source[i + 1] !== '{') fail(`a reference opens with "{{", not a lone "{" (at position ${i})`);
      const close = source.indexOf('}}', i + 2);
      if (close < 0) fail(`the reference starting at position ${i} never closes with "}}"`);
      const name = source.slice(i + 2, close).trim();
      if (!isKnownRef(name)) {
        fail(
          `{{${name}}} is not a reference this grammar knows — use value, roll, dice, llm, params.x, metadata.key, or state.path`
        );
      }
      tokens.push({ kind: 'ref', name });
      i = close + 2;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      let text = '';
      i += 1;
      let closed = false;
      while (i < source.length) {
        const c = source[i];
        if (c === '\\') {
          if (i + 1 >= source.length) fail('a string ends on a dangling backslash');
          text += source[i + 1];
          i += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          i += 1;
          break;
        }
        text += c;
        i += 1;
      }
      if (!closed) fail(`a string opened with ${quote} never closes`);
      tokens.push({ kind: 'string', value: text });
      continue;
    }

    if (ch >= '0' && ch <= '9') {
      const match = /^\d+(\.\d+)?/.exec(source.slice(i));
      if (!match) fail(`malformed number at position ${i}`);
      const text = match![0];
      tokens.push({ kind: 'number', value: Number(text) });
      i += text.length;
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(source.slice(i));
      const word = match![0];
      if (word === 'true' || word === 'false') {
        tokens.push({ kind: 'boolean', value: word === 'true' });
        i += word.length;
        continue;
      }
      // Bare words are the quoting trap: `broken pick` instead of `'broken
      // pick'`. Say so, because this is the mistake every author makes once.
      fail(
        `"${word}" is a bare word — there are no identifiers here. Quote literal text ('${word}') or use a {{ref}}`
      );
    }

    fail(`unexpected character "${ch}" at position ${i}`);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser — recursive descent over the closed grammar
// ---------------------------------------------------------------------------

/**
 * expression = term { ("+" | "-") term } ;
 * term       = factor { ("*" | "/") factor } ;
 * factor     = number | string | boolean | ref | "(" expression ")" | "-" factor ;
 */
class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  parse(): ExprNode {
    const root = this.expression(0);
    const leftover = this.peek();
    if (leftover) {
      throw new ExpressionError(`unexpected ${describeToken(leftover)} after the end of the expression`);
    }
    return root;
  }

  private expression(depth: number): ExprNode {
    let left = this.term(depth);
    for (;;) {
      const token = this.peek();
      if (token?.kind !== 'op' || (token.op !== '+' && token.op !== '-')) return left;
      this.next();
      left = { kind: 'binary', op: token.op, left, right: this.term(depth) };
    }
  }

  private term(depth: number): ExprNode {
    let left = this.factor(depth);
    for (;;) {
      const token = this.peek();
      if (token?.kind !== 'op' || (token.op !== '*' && token.op !== '/')) return left;
      this.next();
      left = { kind: 'binary', op: token.op, left, right: this.factor(depth) };
    }
  }

  private factor(depth: number): ExprNode {
    const token = this.next();
    if (!token) throw new ExpressionError('the expression ends where a value was expected');

    switch (token.kind) {
      case 'number':
      case 'string':
      case 'boolean':
        return { kind: 'literal', value: token.value };
      case 'ref':
        return { kind: 'ref', name: token.name };
      case 'lparen': {
        if (depth + 1 > MAX_EFFECT_EXPRESSION_DEPTH) {
          throw new ExpressionError(`parentheses nest deeper than ${MAX_EFFECT_EXPRESSION_DEPTH} levels`);
        }
        const inner = this.expression(depth + 1);
        const close = this.next();
        if (close?.kind !== 'rparen') throw new ExpressionError('an opening "(" never closes');
        return inner;
      }
      case 'op':
        if (token.op === '-') return { kind: 'negate', operand: this.factor(depth) };
        throw new ExpressionError(`"${token.op}" appears where a value was expected`);
      case 'rparen':
        throw new ExpressionError('")" appears where a value was expected');
    }
  }
}

function describeToken(token: Token): string {
  switch (token.kind) {
    case 'number':
      return `number ${token.value}`;
    case 'string':
      return `string '${token.value}'`;
    case 'boolean':
      return String(token.value);
    case 'ref':
      return `{{${token.name}}}`;
    case 'op':
      return `"${token.op}"`;
    case 'lparen':
      return '"("';
    case 'rparen':
      return '")"';
  }
}

function collectRefs(node: ExprNode, into: string[], seen: Set<string>): void {
  switch (node.kind) {
    case 'ref':
      if (!seen.has(node.name)) {
        seen.add(node.name);
        into.push(node.name);
      }
      return;
    case 'negate':
      collectRefs(node.operand, into, seen);
      return;
    case 'binary':
      collectRefs(node.left, into, seen);
      collectRefs(node.right, into, seen);
      return;
    case 'literal':
      return;
  }
}

/**
 * Parse an effect expression. A failure here is a load-time rejection — the
 * dice-notation doctrine: syntax errors are typos, caught in the Workbench and
 * at discovery, never at the table.
 */
export function parseExpression(source: string): ParseExpressionResult {
  if (source.length === 0) return { ok: false, reason: 'the expression is empty' };
  if (source.length > MAX_EFFECT_EXPRESSION_LENGTH) {
    return { ok: false, reason: `the expression exceeds ${MAX_EFFECT_EXPRESSION_LENGTH} characters` };
  }

  try {
    const tokens = tokenize(source);
    if (tokens.length === 0) return { ok: false, reason: 'the expression is empty' };
    if (tokens.length > MAX_EFFECT_EXPRESSION_TOKENS) {
      return { ok: false, reason: `the expression exceeds ${MAX_EFFECT_EXPRESSION_TOKENS} tokens` };
    }
    const root = new Parser(tokens).parse();
    const refs: string[] = [];
    collectRefs(root, refs, new Set());
    return { ok: true, expr: { root, refs, source } };
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, reason: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

/** Concatenation stringifies by the template convention. */
function stringify(value: ExprValue): string {
  return typeof value === 'number' ? formatValue(value) : String(value);
}

function typeName(value: ExprValue): string {
  return typeof value;
}

function evaluateNode(
  node: ExprNode,
  resolveRef: (refname: string) => ExprValue | undefined
): ExprValue {
  switch (node.kind) {
    case 'literal':
      return node.value;

    case 'ref': {
      const value = resolveRef(node.name);
      if (value === undefined) {
        throw new ExpressionError(`{{${node.name}}} did not resolve to a value`);
      }
      return value;
    }

    case 'negate': {
      const operand = evaluateNode(node.operand, resolveRef);
      if (typeof operand !== 'number') {
        throw new ExpressionError(`"-" negates a ${typeName(operand)}, and only numbers can be negated`);
      }
      return -operand;
    }

    case 'binary': {
      const left = evaluateNode(node.left, resolveRef);
      const right = evaluateNode(node.right, resolveRef);

      if (node.op === '+') {
        if (typeof left === 'number' && typeof right === 'number') {
          return finiteOrFail(left + right, '+');
        }
        // At least one string operand → concatenation. Booleans participate
        // only here (as "true"/"false"); there is no truthiness arithmetic.
        if (typeof left === 'string' || typeof right === 'string') {
          return stringify(left) + stringify(right);
        }
        throw new ExpressionError(
          `"+" adds a ${typeName(left)} and a ${typeName(right)} — it takes two numbers, or a string to concatenate`
        );
      }

      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new ExpressionError(
          `"${node.op}" takes two numbers, got a ${typeName(left)} and a ${typeName(right)}`
        );
      }
      const result = node.op === '-' ? left - right : node.op === '*' ? left * right : left / right;
      return finiteOrFail(result, node.op);
    }
  }
}

/** Any non-finite arithmetic result — including division by zero — fails the eval. */
function finiteOrFail(result: number, op: string): number {
  if (!Number.isFinite(result)) {
    throw new ExpressionError(`"${op}" produced a value that is not a finite number`);
  }
  return result;
}

/**
 * Evaluate a parsed expression against a run's subjects.
 *
 * `resolveRef` returning `undefined` (an absent metadata key, a non-primitive
 * state value, a consult that never ran) is an eval failure — the caller skips
 * that effect fail-soft, per the `renderTemplate` doctrine: a broken effect
 * never sinks a roll.
 */
export function evaluateExpression(
  expr: ParsedExpression,
  resolveRef: (refname: string) => ExprValue | undefined
): EvaluateExpressionResult {
  try {
    return { ok: true, value: evaluateNode(expr.root, resolveRef) };
  } catch (error) {
    if (error instanceof ExpressionError) return { ok: false, reason: error.message };
    throw error;
  }
}
