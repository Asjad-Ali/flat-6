export const CATEGORIES = ['Groceries', 'Milk', 'Electricity', 'Gas', 'Internet', 'Rent', 'Other'] as const;

export type Category = (typeof CATEGORIES)[number];

export interface CategoryMeta {
  /** Ionicons glyph name. */
  icon: string;
  color: string;
  tint: string;
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  Groceries: { icon: 'cart-outline', color: '#16A34A', tint: '#DCFCE7' },
  Milk: { icon: 'water-outline', color: '#0284C7', tint: '#E0F2FE' },
  Electricity: { icon: 'flash-outline', color: '#CA8A04', tint: '#FEF9C3' },
  Gas: { icon: 'flame-outline', color: '#EA580C', tint: '#FFEDD5' },
  Internet: { icon: 'wifi-outline', color: '#7C3AED', tint: '#EDE9FE' },
  Rent: { icon: 'home-outline', color: '#DB2777', tint: '#FCE7F3' },
  Other: { icon: 'pricetag-outline', color: '#475569', tint: '#F1F5F9' },
};

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}
