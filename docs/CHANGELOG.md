# Quilltap Changelog

## Recent Changes

### 4.10-dev

### 4.9.2

#### Fixed: a help chat's tool results now reach the model on every provider (bug 124)

Asking the Help dialog something the character had to look up ("Where do I change the theme? Take me
there.") produced nothing on OpenAI, Anthropic, OpenRouter, Grok, Ollama, DeepSeek, NanoGPT and Z.AI
seats. The help chat's own agent loop sent tool results back as `tool` messages with no call id and
an assistant turn with no tool calls attached. Every provider plugin except Google drops a tool row
it cannot pair, so the model never saw its search results, searched again, and the repeated-call
guard ended the turn with an empty reply. Google seats answered because that plugin keeps an
unpaired row.

- The help loop now builds its assistant turn and tool rows through the same threading helpers the
  Salon and the Brahma Console use. A result with a provider call id is paired to its call; one
  without (the text-block tool path) is framed as `[Tool Result: <name>]` user text.
- The stuck-loop reminder now uses the last result directly instead of searching the message list
  by role.
- Two regression tests drive one native tool turn through the help loop and check the messages
  the follow-up request receives.

#### Fixed: Google no longer rejects a tool-enabled turn whose tool slate includes the wardrobe tools (bug 125)

A Gemini profile with tool use on, in a help chat or in any chat whose character has a wardrobe,
failed every turn with `Invalid JSON payload received. Unknown name "additionalProperties" at
'...parameters.properties[0].value.items'`. The Google plugin strips JSON Schema fields Google's
function-calling API does not accept, but `additionalProperties` was not on the list. The top-level
one never reached the wire, while the one under the wardrobe tools' `operations` array items did.

- `additionalProperties` is now stripped at every depth. Google plugin 1.1.51.
- A regression test runs the real `wardrobe_wear` and `wardrobe_take_off` schemas through the
  sanitizer. Loading the plugin under Jest needed a manual mock for the ESM-only `@google/genai` SDK.

### 4.9.1

#### Fixed: a paused chat no longer goes quiet without saying so, and Skip is always offered (bug 123)

When a chained character turn failed (a provider error that exhausted the fallback chain), the server
paused the chat as a safety stop. The Salon learned of the first pause and showed Resume, but not of a
second one a few minutes later: the client only re-read the pause flag when the fetched value changed,
and pressing Resume had changed the local flag without updating the fetched copy. The fetched value went
from paused to paused, nothing fired, and the client believed the chat was live while the server held it
paused. Every message then drew exactly one reply, nudges worked but chained nowhere, and the sidebar
read "Pause" throughout. A reload was the only fix.

- The client now reconciles its pause flag with the server's on every fetch, and Pause/Resume update
  the fetched chat object too.
- A turn chain that stops because the chat is paused now emits a `paused` chain-complete event and
  logs, instead of returning silently. Every chain-complete carries a `paused` flag; the chain-error
  safety stop sets it, an empty-response stop does not.
- The Salon shows a toast when a chain stops on a pause the user did not cause, with specific wording
  when a character's turn failed. All-LLM rooms keep their existing pause dialog instead.
- The Skip button is offered whenever the composer will accept a message as a character you control,
  your own or one you are impersonating, not only when the rotation has formally landed on that seat.
  The banner wording says whose turn it is. Skipping an impersonated seat now works from the client
  (the server already allowed it), and skipping lifts a pause first, as nudging does. The must-speak
  guard is unchanged.
