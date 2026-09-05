/**
 * Unit tests for `appliesToModels` matching.
 *
 * The gating rule this encodes is asymmetric on purpose: a field with no
 * matcher list renders everywhere, and so does one whose host does not know
 * the selected model — a setting the user cannot see is a setting they cannot
 * reach, so "unknown" errs toward showing it.
 */

import { fieldAppliesToModel, modelMatchesPattern } from '../model-matchers';

describe('modelMatchesPattern', () => {
  it('matches an exact id', () => {
    expect(modelMatchesPattern('flux-lora', 'flux-lora')).toBe(true);
    expect(modelMatchesPattern('hidream', 'flux-lora')).toBe(false);
  });

  it('matches a family prefix', () => {
    expect(modelMatchesPattern('flux-lora/inpainting', 'flux-lora')).toBe(true);
    expect(modelMatchesPattern('flux', 'flux-lora')).toBe(false);
  });

  it('matches a trailing glob', () => {
    expect(modelMatchesPattern('wavespeed-ai/krea-v2/turbo-lora', 'wavespeed-ai/*')).toBe(true);
    expect(modelMatchesPattern('pruna-ai/p-image/edit-lora', 'wavespeed-ai/*')).toBe(false);
  });

  it('matches a leading glob', () => {
    expect(modelMatchesPattern('z-image-turbo-lora', '*-lora')).toBe(true);
    expect(modelMatchesPattern('z-image-turbo', '*-lora')).toBe(false);
  });

  it('does not let regex metacharacters in a pattern run wild', () => {
    // A literal '.' must stay literal, or `gpt-image-1.5` would match
    // `gpt-image-125` and a field would appear on the wrong model.
    expect(modelMatchesPattern('gpt-image-125', 'gpt-image-1.5*')).toBe(false);
    expect(modelMatchesPattern('gpt-image-1.5', 'gpt-image-1.5*')).toBe(true);
  });

  it('never matches an empty pattern', () => {
    expect(modelMatchesPattern('anything', '')).toBe(false);
  });
});

describe('fieldAppliesToModel', () => {
  it('renders unconditionally with no matcher list', () => {
    expect(fieldAppliesToModel(undefined, 'hidream')).toBe(true);
    expect(fieldAppliesToModel([], 'hidream')).toBe(true);
  });

  it('renders unconditionally when the model is unknown', () => {
    expect(fieldAppliesToModel(['flux-lora'], undefined)).toBe(true);
  });

  it('renders when any matcher hits', () => {
    expect(fieldAppliesToModel(['hidream', 'flux-2-*'], 'flux-2-dev-lora')).toBe(true);
  });

  it('hides when no matcher hits', () => {
    expect(fieldAppliesToModel(['hidream', 'flux-2-*'], 'recraft-v3')).toBe(false);
  });
});
