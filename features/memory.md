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
- [ ] **Very Important:** We *never* want to throw an error because we overloaded the token limint on an LLM we're calling via API!

## Vector Database

- [ ] as part of memory management as a whole, we need to keep a vector database up to date for memories
- [ ] we also may need a vector database per conversation
- [ ] When we create the world-book and lore system, we need a vector database for that for sure
- [ ] We should use the "cheap LLM" (or perhaps another "cheap embedding endpoint") to keep those vector database entries up to date
