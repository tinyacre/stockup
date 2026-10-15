import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Registers the theme's font sizes, which tailwind-merge would otherwise read as text colors.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ['title-page', 'title-section', 'num-hero', 'num-xl', 'num-lg', 'num-md', 'num-sm'] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
