/**
 * ESLint plugin to catch the "quilt"-based misspelling of "Quilltap" (any capitalization).
 *
 * The check covers identifiers (variables, functions, properties, globals), string
 * literals, template chunks, JSX names and text, and comments — a misspelled global
 * such as `__quil<t>tapDbKeyState` silently reads/writes the wrong key, so identifiers
 * matter as much as user-visible strings.
 *
 * This file is exempted from its own rule in eslint.config.mjs, since it necessarily
 * spells the forbidden word.
 */

const MISSPELLING = /quilttap(?!ap)/i

module.exports = {
  rules: {
    'no-quilltap-misspelling': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow misspelling of "Quilltap" as "Quilttap" in any capitalization',
          category: 'Possible Errors',
          recommended: true,
        },
        messages: {
          misspelled: 'Misspelled "Quilttap" detected. Did you mean "Quilltap"?',
        },
      },
      create(context) {
        const report = (node) => context.report({ node, messageId: 'misspelled' })

        return {
          Program() {
            const sourceCode = context.sourceCode ?? context.getSourceCode()
            for (const comment of sourceCode.getAllComments()) {
              if (MISSPELLING.test(comment.value)) {
                context.report({ loc: comment.loc, messageId: 'misspelled' })
              }
            }
          },
          Literal(node) {
            if (typeof node.value === 'string' && MISSPELLING.test(node.value)) {
              report(node)
            }
          },
          TemplateElement(node) {
            if (MISSPELLING.test(node.value.raw)) {
              report(node)
            }
          },
          Identifier(node) {
            if (MISSPELLING.test(node.name)) {
              report(node)
            }
          },
          PrivateIdentifier(node) {
            if (MISSPELLING.test(node.name)) {
              report(node)
            }
          },
          JSXIdentifier(node) {
            if (MISSPELLING.test(node.name)) {
              report(node)
            }
          },
          JSXText(node) {
            if (MISSPELLING.test(node.value)) {
              report(node)
            }
          },
        }
      },
    },
  },
}
