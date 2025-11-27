# Feature Request: Memory

Every character should have a memory that updates and cleans itself up automatically as we chat with the character.

## Prerequisites and Plans

- [ ] Cheap LLM for summarization and housecleaning
- [ ] Separate storage of memories that are associated with a given character
- [ ] Each memory should have content, keywords (string array), tags (tag array derived from character, persona, conversation tags)
- [ ] Memories should auto-form based on conversations
- [ ] There should be, in the character view/edit pages, an interface to view/edit memories
- [ ] There should be full CRUD support for memories
- [ ] There should be, as part of memory management in a conversation, something that summarizes important memories and the conversation we're in now, to keep the total context that is sent to the LLM under a defined threshold (adaptable by connection profile) - it can call the "cheap LLM" to handle those things to keep conversations manageable
- [ ] **Very Important:** We *never* want to throw an error because we overloaded the token limit on an LLM we're calling via API!

## Vector Database

- [ ] as part of memory management as a whole, we need to keep a vector database up to date for memories
- [ ] we also may need a vector database per conversation
- [ ] When we create the world-book and lore system, we need a vector database for that for sure
- [ ] We should use the "cheap LLM" (or perhaps another "cheap embedding endpoint") to keep those vector database entries up to date

## How to determine the "Cheap LLM"

- First possibility: allow the user to designate one
- Second possibility: choose the cheapest version of the current provider/model (e.g., if we're using Sonnet 4.5, use Haiku 4.5; if we're using OpenAI GPT-5.1 Thinking, use GPT-5.1 Mini)
- Third possibility: if there is one available via localhost like an Ollama-hosted one, use that (but watch for proxies, they may gate us to more expensive back-ends)

## "Cheap LLM" Use cases that should take place automatically as a chat conversation progresses from one message to the next

- Summarize this chat
- Is there something significant worth remembering in this message, and if so, at its most distilled, what is it?
- Title this chat based on what is happening and/or the topics being discussed, with an eye toward uniquely recognizing this among many chats
- If this message adds to or significantly changes the chat summary, update the summary
- What is in this image or document or file?

## Impact to chats

- A chat should have some guide to the memory of the character and his/her interaction with this persona
- A chat should have some guide to the memory of the character and his/her interactions with other characters
- A chat should have some guide to what a scenario or the context entails
- A tool should be made available that will enable a deeper dive into a character's memory given search terms, that uses the vector databases associated with the character or this chat to deliver information back to the LLM so that it has the information it needs to respond better
