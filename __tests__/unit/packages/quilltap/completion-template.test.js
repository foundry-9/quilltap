/**
 * Regression coverage for zsh completion template wiring.
 *
 * The 4.5-cli fix replaced a broken top-level positional spec
 * (`"1: :(${subcommands[@]%:*})"`) that caused zsh to error with
 * "doubled argument definition" on first tab.
 */

const fs = require('fs');
const path = require('path');

describe('quilltap completion templates', () => {
  test('zsh template uses ->subcommand state pattern (regression for doubled argument definition)', () => {
    const templatePath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'packages',
      'quilltap',
      'lib',
      'completion',
      'zsh.template'
    );

    const template = fs.readFileSync(templatePath, 'utf8');

    expect(template).toContain('_arguments -C');
    // Prefix-agnostic: bug 101 (4.9) put a `(-)` in front of this spec so that a
    // flag typed after the subcommand is left to that subcommand's own
    // _arguments. The invariant this test guards is the ->subcommand *state*,
    // not the word in front of it.
    expect(template).toContain(": :->subcommand'");
    expect(template).toContain("_describe 'command' subcommands");

    // Legacy pattern that split the subcommand spec into separate words in zsh.
    expect(template).not.toContain('"1: :(${subcommands[@]%:*})"');
  });
});
