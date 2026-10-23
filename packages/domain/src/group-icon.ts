// A Category Group's icon is either one of these presets, which the apps draw in their own icon style,
// or a single emoji.
export const groupIconPresets = [
  'paw-print',
  'cat',
  'dog',
  'baby',
  'milk',
  'coffee',
  'cup-soda',
  'wine',
  'apple',
  'carrot',
  'salad',
  'beef',
  'fish',
  'egg',
  'wheat',
  'croissant',
  'cookie',
  'candy',
  'popcorn',
  'soup',
  'utensils',
  'shower-head',
  'bath',
  'spray-can',
  'sparkles',
  'pill',
  'shirt',
  'sofa',
  'washing-machine',
  'toilet',
  'gift',
  'book-open',
  'gamepad-2',
  'dumbbell',
  'flower-2',
  'leaf',
  'car',
  'smartphone',
  'package',
  'shopping-basket',
] as const;

export type GroupIconPreset = (typeof groupIconPresets)[number];

export function isGroupIconPreset(value: string): value is GroupIconPreset {
  return (groupIconPresets as readonly string[]).includes(value);
}

const segmenter = new Intl.Segmenter();

export function isGroupIcon(value: string): boolean {
  if (isGroupIconPreset(value)) return true;
  const graphemes = [...segmenter.segment(value)];
  return graphemes.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(value);
}
