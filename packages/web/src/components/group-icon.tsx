import { useState, type FormEvent } from 'react';
import {
  Apple,
  Baby,
  Bath,
  Beef,
  BookOpen,
  Candy,
  Car,
  Carrot,
  Cat,
  Coffee,
  Cookie,
  Croissant,
  CupSoda,
  Dog,
  Dumbbell,
  Egg,
  Fish,
  Flower2,
  Folder,
  Gamepad2,
  Gift,
  Leaf,
  Milk,
  Package,
  PawPrint,
  Pill,
  Popcorn,
  Salad,
  Shirt,
  ShoppingBasket,
  ShowerHead,
  Smartphone,
  Sofa,
  Soup,
  Sparkles,
  SprayCan,
  Toilet,
  Utensils,
  WashingMachine,
  Wheat,
  Wine,
  type LucideIcon,
} from 'lucide-react';
import { groupIconPresets, isGroupIcon, isGroupIconPreset, type GroupIconPreset } from '@stockup/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const presetIcons: Record<GroupIconPreset, LucideIcon> = {
  'paw-print': PawPrint,
  cat: Cat,
  dog: Dog,
  baby: Baby,
  milk: Milk,
  coffee: Coffee,
  'cup-soda': CupSoda,
  wine: Wine,
  apple: Apple,
  carrot: Carrot,
  salad: Salad,
  beef: Beef,
  fish: Fish,
  egg: Egg,
  wheat: Wheat,
  croissant: Croissant,
  cookie: Cookie,
  candy: Candy,
  popcorn: Popcorn,
  soup: Soup,
  utensils: Utensils,
  'shower-head': ShowerHead,
  bath: Bath,
  'spray-can': SprayCan,
  sparkles: Sparkles,
  pill: Pill,
  shirt: Shirt,
  sofa: Sofa,
  'washing-machine': WashingMachine,
  toilet: Toilet,
  gift: Gift,
  'book-open': BookOpen,
  'gamepad-2': Gamepad2,
  dumbbell: Dumbbell,
  'flower-2': Flower2,
  leaf: Leaf,
  car: Car,
  smartphone: Smartphone,
  package: Package,
  'shopping-basket': ShoppingBasket,
};

const suggestedEmoji = [
  '🐱',
  '🐶',
  '🐾',
  '👶',
  '🍼',
  '🥛',
  '☕',
  '🍵',
  '🍷',
  '🥤',
  '🍎',
  '🥬',
  '🥩',
  '🐟',
  '🥚',
  '🍚',
  '🍞',
  '🍜',
  '🍪',
  '🍫',
  '🍿',
  '🧂',
  '🧴',
  '🧼',
  '🧻',
  '🧽',
  '🧹',
  '🧺',
  '💊',
  '🩹',
  '💄',
  '👕',
  '👟',
  '🛋️',
  '🎁',
  '📚',
  '🎮',
  '🌸',
  '🌿',
  '🚗',
  '📱',
  '🔋',
  '🏠',
  '🛒',
];

// A group without an icon shows a folder.
export function GroupIcon({ icon, className }: { icon: string | null; className?: string }) {
  if (!icon || isGroupIconPreset(icon)) {
    const Icon = icon === null ? Folder : presetIcons[icon as GroupIconPreset];
    return <Icon aria-hidden className={cn('size-4 shrink-0', className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn('inline-grid size-4 shrink-0 place-items-center text-[15px] leading-none', className)}
    >
      {icon}
    </span>
  );
}

export function GroupIconPicker({
  name,
  icon,
  onChange,
}: {
  name: string;
  icon: string | null;
  onChange(icon: string | null): void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const choose = (next: string | null) => {
    setOpen(false);
    setCustom('');
    if (next !== icon) onChange(next);
  };
  const customValid = isGroupIcon(custom.trim());

  function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (customValid) choose(custom.trim());
  }

  const option = (value: string, content: React.ReactNode, label: string) => (
    <button
      key={value}
      type="button"
      aria-label={label}
      aria-pressed={value === icon}
      className="grid size-8 place-items-center rounded-md text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink aria-pressed:bg-surface-selected aria-pressed:text-ink aria-pressed:shadow-[inset_0_0_0_1px_var(--line-strong)] focus-visible:shadow-focus focus-visible:outline-none"
      onClick={() => choose(value)}
    >
      {content}
    </button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label={`设置 ${name} 的图标`} className="text-ink-2">
          <GroupIcon icon={icon} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-[19rem] flex-col gap-3" aria-label="选择图标">
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-ink-3">图标</h3>
          <div className="grid grid-cols-8 gap-0.5">
            {groupIconPresets.map((preset) => option(preset, <GroupIcon icon={preset} />, `图标 ${preset}`))}
          </div>
        </section>
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-ink-3">Emoji</h3>
          <div className="grid grid-cols-8 gap-0.5">
            {suggestedEmoji.map((emoji) => option(emoji, <span className="text-lg leading-none">{emoji}</span>, emoji))}
          </div>
          <form className="flex gap-2 pt-1" onSubmit={submitCustom}>
            <Input
              aria-label="其他 emoji"
              placeholder="粘贴或输入一个 emoji"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={!customValid}>
              使用
            </Button>
          </form>
        </section>
        {icon && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => choose(null)}>
            移除图标
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
