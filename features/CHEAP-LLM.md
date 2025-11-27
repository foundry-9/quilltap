# Feature: improving "Cheap LLM" selection

## Selecting the "Cheap LLM"

1. Add a boolean property to every connection profile to mark it "cheap"
2. Add a global choice of one connection profile to always use as the "cheap" one
3. If one of them aren't selected as "THE Cheap LLM", then use any one with the "cheap" flag set to true
4. If there isn't one (or isn't one available) to use as the Cheap LLM, toast this fact as a warning and just use whatever is the current LLM being used for the chat or character being interacted with

## Embedding connections

1. In addition to connection profiles and image generation connection profiles, add a third one: "text embedding connection profiles", endpoints just to use for embedding text (send text, receive back information for our vector database)
2. Only possibilities right now for providers are OpenAI and Ollama

## Failover

If embedding isn't possible for some reason, then just use ordinary search heuristics (slow):

- break searches into words and exact phrases
- higher scores (match rates) get used for answers
