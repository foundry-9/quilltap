import {
  CORE_WHISPER_PREAMBLE,
  buildCoreWhisperContent,
  buildCoreWhisperLLMContext,
  buildCoreWhisperOpaqueContent,
  resolveCoreWhisperConfig,
  type CorePacket,
} from '../core-whisper';

const samplePacket: CorePacket = {
  files: [
    {
      path: 'Core/manifesto.md',
      body: 'I keep my word to those who keep theirs to me.',
    },
    {
      path: 'Core/desires.md',
      body: 'I want a workshop with daylight enough to read a watchmaker’s scale by.',
    },
  ],
  approxTokens: 50,
};

describe('Core whisper builders', () => {
  it('preamble matches the snapshot verbatim', () => {
    expect(CORE_WHISPER_PREAMBLE).toMatchSnapshot();
  });

  it('buildCoreWhisperContent includes Aurora narrative opener, preamble verbatim, and every file', () => {
    const out = buildCoreWhisperContent(samplePacket);
    expect(out).toContain('Aurora pauses beside the workbench');
    expect(out).toContain(CORE_WHISPER_PREAMBLE);
    expect(out).toContain('### Core/manifesto.md');
    expect(out).toContain('I keep my word');
    expect(out).toContain('### Core/desires.md');
    expect(out).toContain('workshop with daylight');
  });

  it('buildCoreWhisperOpaqueContent strips Aurora narrative opener but keeps preamble + bodies', () => {
    const out = buildCoreWhisperOpaqueContent(samplePacket);
    expect(out).not.toContain('Aurora pauses');
    expect(out).toContain(CORE_WHISPER_PREAMBLE);
    expect(out).toContain('### Core/manifesto.md');
    expect(out).toContain('### Core/desires.md');
  });

  it('buildCoreWhisperLLMContext opens plainly, has preamble, includes advisory close', () => {
    const out = buildCoreWhisperLLMContext(samplePacket);
    expect(out.startsWith('Your own center of gravity, as you have written it for yourself:')).toBe(true);
    expect(out).toContain(CORE_WHISPER_PREAMBLE);
    expect(out).toContain('### Core/manifesto.md');
    expect(out).toContain('### Core/desires.md');
    expect(out).toContain('This material is offered, not imposed.');
    expect(out).toContain('Ask whether this still comes from you.');
  });

  it('LLM context places advisory paragraph at the end', () => {
    const out = buildCoreWhisperLLMContext(samplePacket);
    expect(out.trimEnd().endsWith('Ask whether this still comes from you.')).toBe(true);
  });

  it('LLM context form does NOT include the Aurora narrative opener', () => {
    const out = buildCoreWhisperLLMContext(samplePacket);
    expect(out).not.toContain('Aurora pauses');
  });
});

describe('group-sourced Core file labels', () => {
  const packetWithGroup: CorePacket = {
    files: [
      { path: 'Core/manifesto.md', body: 'I keep my own counsel.' },
      {
        path: 'Core/charter.md',
        body: 'The Circle keeps faith with its own.',
        sourceLabel: 'The Ravenmoor Circle',
      },
    ],
    approxTokens: 40,
  };

  it('personal files render an unlabeled heading; group files carry [Shared — <group>]', () => {
    for (const out of [
      buildCoreWhisperContent(packetWithGroup),
      buildCoreWhisperOpaqueContent(packetWithGroup),
      buildCoreWhisperLLMContext(packetWithGroup),
    ]) {
      expect(out).toContain('### Core/manifesto.md');
      expect(out).not.toContain('### [Shared — The Ravenmoor Circle] Core/manifesto.md');
      expect(out).toContain('### [Shared — The Ravenmoor Circle] Core/charter.md');
      expect(out).toContain('The Circle keeps faith with its own.');
    }
  });
});

describe('resolveCoreWhisperConfig', () => {
  const defaults = {
    enabled: true,
    interval: 12,
    silenceThreshold: 3,
    packetTokenBudget: 4096,
    fireOnContextTransition: true,
  };

  it('returns global defaults when no overrides set', () => {
    const r = resolveCoreWhisperConfig({}, {}, defaults);
    expect(r).toEqual(defaults);
  });

  it('chat enabled override wins over character and global', () => {
    const r = resolveCoreWhisperConfig(
      { coreWhisperEnabled: false },
      { coreWhisperEnabled: true },
      { ...defaults, enabled: true },
    );
    expect(r.enabled).toBe(false);
  });

  it('character enabled override wins over global when chat is unset', () => {
    const r = resolveCoreWhisperConfig(
      { coreWhisperEnabled: null },
      { coreWhisperEnabled: false },
      { ...defaults, enabled: true },
    );
    expect(r.enabled).toBe(false);
  });

  it('chat interval override wins over global', () => {
    const r = resolveCoreWhisperConfig(
      { coreWhisperInterval: 5 },
      {},
      { ...defaults, interval: 12 },
    );
    expect(r.interval).toBe(5);
  });

  it('precedence: chat > character > global for enabled', () => {
    expect(
      resolveCoreWhisperConfig(
        { coreWhisperEnabled: true },
        { coreWhisperEnabled: false },
        { ...defaults, enabled: false },
      ).enabled,
    ).toBe(true);
    expect(
      resolveCoreWhisperConfig(
        { coreWhisperEnabled: null },
        { coreWhisperEnabled: true },
        { ...defaults, enabled: false },
      ).enabled,
    ).toBe(true);
    expect(
      resolveCoreWhisperConfig(
        { coreWhisperEnabled: null },
        { coreWhisperEnabled: null },
        { ...defaults, enabled: true },
      ).enabled,
    ).toBe(true);
  });

  it('falls back to hard defaults when global is missing entirely', () => {
    const r = resolveCoreWhisperConfig(null, null, null);
    expect(r).toEqual({
      enabled: true,
      interval: 12,
      silenceThreshold: 3,
      packetTokenBudget: 4096,
      fireOnContextTransition: true,
    });
  });
});
