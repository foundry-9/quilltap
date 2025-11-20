# Template System

Quilltap supports SillyTavern-compatible template variables for character and persona data. This allows for dynamic content replacement in character definitions, example dialogues, and system prompts.

## Supported Template Variables

The following template variables are **currently supported** in Quilltap:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{char}}` | Character's name | `{{char}}` → `Alice` |
| `{{user}}` | User/persona's name | `{{user}}` → `Bob` |
| `{{description}}` | Character's description field | Full character description |
| `{{personality}}` | Character's personality traits | Personality summary |
| `{{scenario}}` | Current scenario/setting | Scenario description |
| `{{persona}}` | Persona's description | User persona description |
| `{{system}}` | System prompt or character's main prompt override | System instructions |
| `{{mesExamples}}` | Character's example dialogues (formatted) | Example conversations |
| `{{mesExamplesRaw}}` | Character's example dialogues (raw) | Unformatted examples |

### Usage Example

Character description field:
```
I am {{char}}, a brave warrior from the northern kingdoms.
I have been sent to protect {{user}} on their journey.
```

When processed with character name "Alice" and persona name "Bob":
```
I am Alice, a brave warrior from the northern kingdoms.
I have been sent to protect Bob on their journey.
```

### Where Templates Work

Template variables are processed in the following character fields:
- Character description
- Character personality
- Character scenario
- First message
- Example dialogues
- System prompt

Templates are automatically processed when building the system prompt for chat initialization.

## Future Template Support

The following features from SillyTavern's template system are **not yet supported** but may be added in the future:

### World Info / Lorebook Variables

| Variable | Description | Use Case |
|----------|-------------|----------|
| `{{wiBefore}}` or `{{loreBefore}}` | World Info entries positioned "Before Char Defs" | Insert lore before character definition in context |
| `{{wiAfter}}` or `{{loreAfter}}` | World Info entries positioned "After Char Defs" | Insert lore after character definition in context |

**Why we may want this:**
World Info (also known as Lorebook) allows for dynamic context injection based on keywords or triggers. This is useful for:
- Large, complex worlds with lots of lore
- Context-sensitive information that only appears when relevant
- Reducing token usage by only including relevant lore
- Sharing world information across multiple characters

**Implementation requirements:**
- Database schema for World Info entries
- Keyword/trigger matching system
- Position control (before/after character defs)
- Activation depth and priority settings
- Integration with character cards

### Anchor Point Variables

| Variable | Description | Use Case |
|----------|-------------|----------|
| `{{anchorBefore}}` | Content positioned "Before Story String" | Custom prompts before main context |
| `{{anchorAfter}}` | Content positioned "After Story String" | Custom prompts after main context |

**Why we may want this:**
Anchor points allow users to inject custom prompts at specific positions in the context. This is useful for:
- Fine-grained control over prompt structure
- Advanced prompt engineering techniques
- Custom instructions that need specific positioning
- Integration with external prompt libraries

**Implementation requirements:**
- UI for managing prompt anchors
- Database storage for anchor content
- Position management in context building
- Support for multiple anchors

### Advanced Formatting

| Feature | Description | Use Case |
|---------|-------------|----------|
| `{{trim}}` macro | Removes surrounding newlines (preserves spaces) | Clean up formatting in templates |
| Handlebars syntax | Full Handlebars template engine support | Conditional logic, loops, helpers |

**Why we may want this:**
Advanced formatting features enable:
- Conditional content based on context
- Loops for repeated content patterns
- Custom helper functions for complex logic
- Better control over whitespace and formatting

**Implementation requirements:**
- Handlebars library integration
- Custom helper functions
- Documentation for advanced syntax
- Security considerations for user-provided templates

### Story String Template

SillyTavern uses a "Story String" concept where the entire prompt structure is defined by a template. This is currently **not supported** in Quilltap.

**Story String example from SillyTavern:**
```
{{anchorBefore}}
{{system}}
{{wiBefore}}
{{description}}
{{personality}}
{{scenario}}
{{wiAfter}}
{{mesExamples}}
{{anchorAfter}}
```

**Why we may want this:**
- Complete control over prompt structure
- Easy switching between different prompt formats
- Compatibility with various AI models that expect different formats
- Support for instruct models with specific formatting requirements

**Implementation requirements:**
- User-defined story string templates
- Template presets for common formats
- Validation and error handling
- Migration path from current system

### Alternative Names / Aliases

| Variable | Alias | Notes |
|----------|-------|-------|
| `{{wiBefore}}` | `{{loreBefore}}` | Both refer to World Info |
| `{{wiAfter}}` | `{{loreAfter}}` | Both refer to World Info |
| `{{char}}` | `{{bot}}` (partially supported) | SillyTavern compatibility |

### Post-History Instructions

| Variable | Description | Use Case |
|----------|-------------|----------|
| `{{post_history_instructions}}` | Instructions inserted after chat history | Context-aware guidance based on conversation |

**Why we may want this:**
- Dynamic instructions based on conversation state
- Reminders for character behavior
- Genre-specific formatting instructions

**Implementation requirements:**
- Database field for post-history instructions
- Position in context building
- Template processing support

## Implementation Status

| Feature | Status | Priority | Notes |
|---------|--------|----------|-------|
| Basic variables (char, user, description, etc.) | ✅ Implemented | - | Core functionality |
| World Info / Lorebook | ❌ Not implemented | High | Popular feature in SillyTavern |
| Anchor points | ❌ Not implemented | Medium | Advanced use case |
| Story String templates | ❌ Not implemented | Medium | Requires UI redesign |
| Handlebars syntax | ❌ Not implemented | Low | Advanced feature |
| `{{trim}}` macro | ❌ Not implemented | Low | Nice to have |
| Post-history instructions | ❌ Not implemented | Medium | Useful for long chats |

## Technical Details

### Current Implementation

Template processing is handled by the `lib/templates/processor.ts` module:

- `processTemplate(template, context)` - Processes a single template string
- `buildTemplateContext(character, persona, scenario)` - Builds the context object
- `processCharacterTemplates(character, persona, scenario)` - Processes all character fields

Templates are processed during chat initialization in `lib/chat/initialize.ts`.

### Performance Considerations

- Template processing is done once during chat initialization
- Minimal performance impact on message sending
- Future implementations should consider caching for large lorebooks

### Security Considerations

If implementing advanced features like Handlebars:
- Sanitize user input to prevent code injection
- Limit available Handlebars helpers to safe operations
- Validate template syntax before execution
- Consider sandboxing for user-provided templates

## References

- [SillyTavern Context Template Documentation](https://docs.sillytavern.app/usage/prompts/context-template/)
- [SillyTavern Advanced Formatting](https://docs.sillytavern.app/usage/core-concepts/advancedformatting/)
- [Handlebars Documentation](https://handlebarsjs.com/guide/)

## Migration Guide

If you're migrating from SillyTavern:

### Supported Features
✅ Your character cards with `{{char}}` and `{{user}}` will work immediately
✅ Example dialogues with template variables are supported
✅ Description, personality, and scenario fields with templates work

### Not Yet Supported
❌ World Info / Lorebook entries will be ignored
❌ Custom story string templates will not be used
❌ Anchor points will not be processed
❌ Handlebars syntax will not be evaluated

### Workarounds

For now, you can:
1. **World Info**: Manually include important lore in the character description or scenario
2. **Story String**: Use our default prompt structure (works well for most use cases)
3. **Anchor Points**: Add custom instructions to the system prompt field
4. **Handlebars**: Manually expand templates before importing

## Contributing

If you'd like to help implement any of these features:

1. Check the GitHub issues for existing feature requests
2. Propose implementation in a discussion
3. Submit a pull request with tests and documentation

Priority areas for contribution:
- World Info / Lorebook system
- Story String template support
- Advanced formatting options
