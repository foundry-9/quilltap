/**
 * Tests for the shared LLM-generated wardrobe item helpers
 * (lib/wardrobe/generated-items) used by the AI Wizard, Summon From Lore,
 * and the character optimizer.
 */

import {
  WARDROBE_ITEMS_GENERATION_PROMPT,
  sanitizeGeneratedWardrobeItems,
  orderGeneratedItemsLeafFirst,
  type GeneratedWardrobeItem,
} from '@/lib/wardrobe/generated-items';

describe('WARDROBE_ITEMS_GENERATION_PROMPT', () => {
  it('teaches the four slot types', () => {
    for (const slot of ['top', 'bottom', 'footwear', 'accessories']) {
      expect(WARDROBE_ITEMS_GENERATION_PROMPT).toContain(`"${slot}"`);
    }
  });

  it('teaches imagePrompt, defaults, and composite outfits', () => {
    expect(WARDROBE_ITEMS_GENERATION_PROMPT).toContain('imagePrompt');
    expect(WARDROBE_ITEMS_GENERATION_PROMPT).toContain('isDefault');
    expect(WARDROBE_ITEMS_GENERATION_PROMPT).toContain('components');
    expect(WARDROBE_ITEMS_GENERATION_PROMPT).toContain('replace');
  });

  it('keeps bodily features out of the wardrobe', () => {
    expect(WARDROBE_ITEMS_GENERATION_PROMPT.toLowerCase()).toContain('physical description');
    expect(WARDROBE_ITEMS_GENERATION_PROMPT.toLowerCase()).toContain('removable');
  });
});

describe('sanitizeGeneratedWardrobeItems', () => {
  it('drops invalid slot types and items with no valid slots', () => {
    const items = sanitizeGeneratedWardrobeItems([
      { title: 'Duster', description: 'Long coat', types: ['top', 'cloak'] },
      { title: 'Ghost Item', description: '', types: ['cloak'] },
    ] as unknown as GeneratedWardrobeItem[]);
    expect(items).toHaveLength(1);
    expect(items[0].types).toEqual(['top']);
  });

  it('drops items without a title or types array', () => {
    const items = sanitizeGeneratedWardrobeItems([
      { title: '', description: 'no title', types: ['top'] },
      { title: 'No Types', description: 'missing', types: undefined },
      { title: 'Boots', description: 'Sturdy', types: ['footwear'] },
    ] as unknown as GeneratedWardrobeItem[]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Boots');
  });

  it('coerces optional fields and normalizes flags', () => {
    const [item] = sanitizeGeneratedWardrobeItems([
      {
        title: '  Duster  ',
        description: 'Long coat',
        imagePrompt: '  worn brown leather duster  ',
        types: ['top'],
        isDefault: 'yes',
        replace: 'true',
      },
    ] as unknown as GeneratedWardrobeItem[]);
    expect(item.title).toBe('Duster');
    expect(item.imagePrompt).toBe('worn brown leather duster');
    expect(item.isDefault).toBe(false);
    expect(item.replace).toBeUndefined();
  });

  it('keeps composite components only when they resolve within the batch', () => {
    const items = sanitizeGeneratedWardrobeItems([
      { title: 'Shirt', description: '', types: ['top'] },
      { title: 'Boots', description: '', types: ['footwear'] },
      {
        title: 'Everyday Outfit',
        description: '',
        types: ['top', 'footwear'],
        isDefault: true,
        components: ['Shirt', 'Boots', 'Nonexistent Hat'],
        replace: true,
      },
      {
        title: 'Broken Outfit',
        description: '',
        types: ['top'],
        components: ['Nothing Real', 'Broken Outfit'],
        replace: true,
      },
    ]);
    const outfit = items.find((i) => i.title === 'Everyday Outfit')!;
    expect(outfit.components).toEqual(['Shirt', 'Boots']);
    expect(outfit.replace).toBe(true);
    expect(outfit.isDefault).toBe(true);
    // A composite whose components all fail to resolve (including a
    // self-reference) degrades to a leaf item.
    const broken = items.find((i) => i.title === 'Broken Outfit')!;
    expect(broken.components).toBeUndefined();
    expect(broken.replace).toBeUndefined();
  });
});

describe('orderGeneratedItemsLeafFirst', () => {
  it('orders leaves before composites, shallow before deep', () => {
    const items: GeneratedWardrobeItem[] = [
      { title: 'Full Kit', description: '', types: ['top'], components: ['Outfit'] },
      { title: 'Outfit', description: '', types: ['top'], components: ['Shirt'] },
      { title: 'Shirt', description: '', types: ['top'] },
    ];
    const ordered = orderGeneratedItemsLeafFirst(items).map((i) => i.title);
    expect(ordered).toEqual(['Shirt', 'Outfit', 'Full Kit']);
  });

  it('leaves an all-leaf batch untouched', () => {
    const items: GeneratedWardrobeItem[] = [
      { title: 'A', description: '', types: ['top'] },
      { title: 'B', description: '', types: ['bottom'] },
    ];
    expect(orderGeneratedItemsLeafFirst(items).map((i) => i.title)).toEqual(['A', 'B']);
  });
});
