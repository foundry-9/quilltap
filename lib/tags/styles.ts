import type { TagVisualStyle } from '@/lib/json-store/schemas/types';

export const DEFAULT_TAG_STYLE: TagVisualStyle = {
  emoji: null,
  foregroundColor: '#1f2937',
  backgroundColor: '#e5e7eb',
};

export function mergeWithDefaultTagStyle(style?: Partial<TagVisualStyle> | null): TagVisualStyle {
  if (!style) {
    return { ...DEFAULT_TAG_STYLE };
  }

  return {
    emoji: typeof style.emoji === 'string' && style.emoji.length > 0 ? style.emoji : null,
    foregroundColor: style.foregroundColor || DEFAULT_TAG_STYLE.foregroundColor,
    backgroundColor: style.backgroundColor || DEFAULT_TAG_STYLE.backgroundColor,
  };
}
