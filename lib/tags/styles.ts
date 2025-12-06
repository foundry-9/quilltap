import type { TagVisualStyle } from '@/lib/schemas/types';

export const DEFAULT_TAG_STYLE: TagVisualStyle = {
  emoji: null,
  foregroundColor: '#1f2937',
  backgroundColor: '#e5e7eb',
  emojiOnly: false,
  bold: false,
  italic: false,
  strikethrough: false,
};

export function mergeWithDefaultTagStyle(style?: Partial<TagVisualStyle> | null): TagVisualStyle {
  if (!style) {
    return { ...DEFAULT_TAG_STYLE };
  }

  return {
    emoji: typeof style.emoji === 'string' && style.emoji.length > 0 ? style.emoji : null,
    foregroundColor: style.foregroundColor || DEFAULT_TAG_STYLE.foregroundColor,
    backgroundColor: style.backgroundColor || DEFAULT_TAG_STYLE.backgroundColor,
    emojiOnly: style.emojiOnly ?? DEFAULT_TAG_STYLE.emojiOnly,
    bold: style.bold ?? DEFAULT_TAG_STYLE.bold,
    italic: style.italic ?? DEFAULT_TAG_STYLE.italic,
    strikethrough: style.strikethrough ?? DEFAULT_TAG_STYLE.strikethrough,
  };
}
