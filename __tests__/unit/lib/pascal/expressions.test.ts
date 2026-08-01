/**
 * Effect expressions — the closed tokenizer/parser/evaluator behind an
 * effect's `value`. Pins down precedence, parentheses, the coercion rules
 * (string concatenation, boolean stringification, no truthiness arithmetic),
 * division-by-zero fail-soft, the source/token/depth bounds, and the bad-ref
 * failure paths.
 */

import {
  parseExpression,
  evaluateExpression,
  formatValue,
  MAX_EFFECT_EXPRESSION_LENGTH,
  MAX_EFFECT_EXPRESSION_TOKENS,
  MAX_EFFECT_EXPRESSION_DEPTH,
  type ExprValue,
} from '@/lib/pascal/expressions'

/** Parse-or-throw, for tests that only care about evaluation. */
function parsed(source: string) {
  const result = parseExpression(source)
  if (!result.ok) throw new Error(`fixture failed to parse: ${result.reason}`)
  return result.expr
}

/** Evaluate with a fixture ref table; absent keys resolve to undefined. */
function evaluate(source: string, refs: Record<string, ExprValue> = {}) {
  return evaluateExpression(parsed(source), (name) => refs[name])
}

function value(source: string, refs: Record<string, ExprValue> = {}): ExprValue {
  const result = evaluate(source, refs)
  if (!result.ok) throw new Error(`fixture failed to evaluate: ${result.reason}`)
  return result.value
}

describe('parseExpression — acceptance', () => {
  it.each([
    '1',
    '1.5',
    "'broken pick'",
    '"double quoted"',
    'true',
    'false',
    '{{value}}',
    '{{roll}}',
    '{{dice}}',
    '{{llm}}',
    '{{params.bonus}}',
    '{{metadata.lockpicks}}',
    '{{state.encounter.count}}',
    '1 + 2 * 3',
    '({{value}} + 1) * 2',
    "-{{state.debt}} / 2 + 'gp'",
  ])('accepts %s', (source) => {
    expect(parseExpression(source).ok).toBe(true)
  })

  it('reports the refs an expression names, deduplicated, in order', () => {
    const result = parseExpression('{{state.a}} + {{params.b}} + {{state.a}}')
    expect(result.ok && result.expr.refs).toEqual(['state.a', 'params.b'])
  })

  it('supports escaped quotes inside strings', () => {
    expect(value("'it\\'s'")).toBe("it's")
    expect(value('"say \\"hi\\""')).toBe('say "hi"')
  })
})

describe('parseExpression — rejection', () => {
  it.each([
    ['', 'empty'],
    ['broken pick', 'bare word'],
    ['foo(1)', 'bare word'],
    ['{{nonsense}}', 'not a reference'],
    ['{{params.}}', 'not a reference'],
    ['{{value', 'never closes'],
    ["'unterminated", 'never closes'],
    ['1 +', 'ends where a value was expected'],
    ['(1 + 2', 'never closes'],
    ['1 2', 'unexpected'],
    ['a.b', 'bare word'],
    ['{value}', 'lone'],
    ['1 % 2', 'unexpected character'],
  ])('rejects %s', (source, fragment) => {
    const result = parseExpression(source)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason.toLowerCase()).toContain(fragment.toLowerCase())
  })

  it('rejects source longer than the cap', () => {
    const long = `'${'x'.repeat(MAX_EFFECT_EXPRESSION_LENGTH)}'`
    const result = parseExpression(long)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(`${MAX_EFFECT_EXPRESSION_LENGTH}`)
  })

  it('rejects more tokens than the cap', () => {
    const many = Array.from({ length: MAX_EFFECT_EXPRESSION_TOKENS / 2 + 1 }, () => '1').join('+')
    const result = parseExpression(many)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain(`${MAX_EFFECT_EXPRESSION_TOKENS}`)
  })

  it('rejects parentheses nested past the depth cap, and accepts them at it', () => {
    const at = `${'('.repeat(MAX_EFFECT_EXPRESSION_DEPTH)}1${')'.repeat(MAX_EFFECT_EXPRESSION_DEPTH)}`
    const past = `${'('.repeat(MAX_EFFECT_EXPRESSION_DEPTH + 1)}1${')'.repeat(MAX_EFFECT_EXPRESSION_DEPTH + 1)}`
    expect(parseExpression(at).ok).toBe(true)
    const result = parseExpression(past)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('nest')
  })
})

describe('evaluateExpression — arithmetic', () => {
  it('applies precedence: * and / bind tighter than + and -', () => {
    expect(value('1 + 2 * 3')).toBe(7)
    expect(value('10 - 6 / 2')).toBe(7)
  })

  it('parentheses override precedence', () => {
    expect(value('(1 + 2) * 3')).toBe(9)
  })

  it('associates left to right', () => {
    expect(value('10 - 3 - 2')).toBe(5)
    expect(value('12 / 3 / 2')).toBe(2)
  })

  it('negates numbers, including refs', () => {
    expect(value('-3 + 1')).toBe(-2)
    expect(value('-{{value}}', { value: 4 })).toBe(-4)
    expect(value('--2')).toBe(2)
  })

  it('fails soft on division by zero', () => {
    const result = evaluate('1 / 0')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('finite')
  })

  it('fails soft on 0 / 0', () => {
    expect(evaluate('0 / 0').ok).toBe(false)
  })

  it('fails soft when negating a non-number', () => {
    expect(evaluate("-'text'").ok).toBe(false)
  })
})

describe('evaluateExpression — strings and booleans', () => {
  it('concatenates when either + operand is a string', () => {
    expect(value("'rolled ' + 3")).toBe('rolled 3')
    expect(value("3 + ' rolled'")).toBe('3 rolled')
    expect(value("'a' + 'b'")).toBe('ab')
  })

  it('stringifies numbers in concatenation via formatValue', () => {
    expect(value("'' + 0.123456")).toBe(formatValue(0.123456))
    expect(value("'' + 7")).toBe('7')
  })

  it('stringifies booleans in concatenation', () => {
    expect(value("'flag: ' + true")).toBe('flag: true')
    expect(value("false + '!'")).toBe('false!')
  })

  it('refuses boolean arithmetic — no truthiness', () => {
    expect(evaluate('true + 1').ok).toBe(false)
    expect(evaluate('true + false').ok).toBe(false)
    expect(evaluate('true * 2').ok).toBe(false)
  })

  it('refuses -, *, / with any non-number operand', () => {
    expect(evaluate("'a' - 1").ok).toBe(false)
    expect(evaluate("'a' * 2").ok).toBe(false)
    expect(evaluate("4 / 'b'").ok).toBe(false)
  })
})

describe('evaluateExpression — references', () => {
  it('substitutes refs of every family', () => {
    expect(
      value('{{value}} + {{params.bonus}} + {{state.floor}}', {
        value: 10,
        'params.bonus': 2,
        'state.floor': 1,
      }),
    ).toBe(13)
  })

  it('concatenates string refs — {{dice}} and {{llm}} are strings', () => {
    expect(value("'rolled ' + {{dice}}", { dice: '3d6: [1, 2, 3] = 6' })).toBe('rolled 3d6: [1, 2, 3] = 6')
  })

  it('never coerces {{llm}} numerically', () => {
    const result = evaluate('{{llm}} * 2', { llm: '21' })
    expect(result.ok).toBe(false)
  })

  it('fails soft when a ref does not resolve', () => {
    const result = evaluate('{{metadata.absent}} + 1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('metadata.absent')
  })
})

describe('formatValue', () => {
  it('renders integers plain and floats to 4 significant digits', () => {
    expect(formatValue(14)).toBe('14')
    expect(formatValue(0.71349)).toBe('0.7135')
  })
})
