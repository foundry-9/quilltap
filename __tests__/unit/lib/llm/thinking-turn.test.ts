import { describe, expect, it } from '@jest/globals'

import { evaluateThinkingTurn, type ThinkingTurnRule } from '@/lib/llm/thinking-turn'

/** The rule the DeepSeek plugin declares (enum: '' | 'enabled' | 'disabled'). */
const DEEPSEEK_RULE: ThinkingTurnRule = {
  optionKey: 'thinking',
  enabledValues: ['enabled'],
  disabledValues: ['disabled'],
}

/** The rule the Ollama plugin declares (a boolean checkbox). */
const OLLAMA_RULE: ThinkingTurnRule = {
  optionKey: 'enable_thinking',
  enabledValues: [true],
  disabledValues: [false],
}

describe('evaluateThinkingTurn', () => {
  it('says no when nothing is known', () => {
    expect(evaluateThinkingTurn({})).toBe(false)
  })

  describe('the model default', () => {
    it('answers yes for a model that reasons unasked', () => {
      // The bug 85 profile exactly: DeepSeek V4 Flash with `parameters: {}`.
      expect(
        evaluateThinkingTurn({
          rule: DEEPSEEK_RULE,
          parameters: {},
          model: { supportsThinking: true, thinksByDefault: true },
        })
      ).toBe(true)
    })

    it('answers no for a model that only reasons when asked', () => {
      expect(
        evaluateThinkingTurn({
          rule: OLLAMA_RULE,
          parameters: {},
          model: { supportsThinking: true },
        })
      ).toBe(false)
    })

    it('treats an empty string as "(model default)", not as a choice', () => {
      // Every enum field in the options schema spells "leave it to the model"
      // as the empty string.
      expect(
        evaluateThinkingTurn({
          rule: DEEPSEEK_RULE,
          parameters: { thinking: '' },
          model: { thinksByDefault: true },
        })
      ).toBe(true)
    })
  })

  describe('the profile choice', () => {
    it('lets an explicit disable overrule a model that reasons unasked', () => {
      // This is bug 68's objection satisfied rather than re-incurred: a
      // thinking-off profile keeps the stronger prefill anchor.
      expect(
        evaluateThinkingTurn({
          rule: DEEPSEEK_RULE,
          parameters: { thinking: 'disabled' },
          model: { thinksByDefault: true },
        })
      ).toBe(false)
    })

    it('lets an explicit enable overrule a model with no stated habit', () => {
      expect(
        evaluateThinkingTurn({
          rule: OLLAMA_RULE,
          parameters: { enable_thinking: true },
          model: null,
        })
      ).toBe(true)
    })

    it('reads a boolean false as a choice, not as absence', () => {
      expect(
        evaluateThinkingTurn({
          rule: OLLAMA_RULE,
          parameters: { enable_thinking: false },
          model: { thinksByDefault: true },
        })
      ).toBe(false)
    })
  })

  it('ignores a rule whose key the profile does not carry', () => {
    expect(
      evaluateThinkingTurn({
        rule: DEEPSEEK_RULE,
        parameters: { temperature: 1, enable_thinking: true },
        model: null,
      })
    ).toBe(false)
  })

  it('falls back to the model when the provider declares no rule', () => {
    // A plugin with no thinking option at all still gets a model-shaped answer.
    expect(evaluateThinkingTurn({ model: { thinksByDefault: true } })).toBe(true)
    expect(evaluateThinkingTurn({ model: { supportsThinking: true } })).toBe(false)
  })

  it('does not confuse "can think" with "will think"', () => {
    // supportsThinking is a capability, not a prediction — only
    // thinksByDefault or an explicit profile choice answers the question.
    expect(evaluateThinkingTurn({ model: { supportsThinking: true, thinksByDefault: false } })).toBe(
      false
    )
  })
})
