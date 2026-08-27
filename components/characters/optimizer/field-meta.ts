/**
 * Optimizer field metadata — the display label and badge class for each
 * character field a suggestion may touch, shared by the review surfaces
 * (`SuggestionCard`, `ApplyConfirmation`) so the two never drift apart.
 */

export const FIELD_LABELS: Record<string, string> = {
  identity: 'Identity',
  description: 'Description',
  manifesto: 'Manifesto',
  personality: 'Personality',
  scenarios: 'Scenario',
  exampleDialogues: 'Example Dialogues',
  firstMessage: 'First Message',
  systemPrompt: 'System Prompt',
  systemPrompts: 'System Prompt',
  physicalDescription: 'Physical Description',
  talkativeness: 'Talkativeness',
  wardrobeItems: 'Wardrobe',
  aliases: 'Alias',
  title: 'Title',
};

export const FIELD_BADGE_CLASS: Record<string, string> = {
  identity: 'qt-badge-primary',
  description: 'qt-badge-secondary',
  manifesto: 'qt-badge-primary',
  personality: 'qt-badge-character',
  scenarios: 'qt-badge-project',
  exampleDialogues: 'qt-badge-chat',
  firstMessage: 'qt-badge-message',
  systemPrompt: 'qt-badge-memory',
  systemPrompts: 'qt-badge-memory',
  physicalDescription: 'qt-badge-user-character',
  talkativeness: 'qt-badge-chat',
  wardrobeItems: 'qt-badge-user-character',
  aliases: 'qt-badge-primary',
  title: 'qt-badge-primary',
};
