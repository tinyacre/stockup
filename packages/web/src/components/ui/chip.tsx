import * as React from "react"
import type { Choice } from "@/components/ui/segmented-control"
import { cn } from "@/lib/utils"

const chipClass = cn(
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-xs whitespace-nowrap text-ink-2 transition-colors outline-none hover:border-ink-4 hover:text-ink focus-visible:shadow-focus [&_svg:not([class*='size-'])]:size-3.5",
  "aria-checked:border-gold-edge aria-checked:bg-gold-soft aria-checked:font-medium aria-checked:text-gold-ink aria-pressed:border-gold-edge aria-pressed:bg-gold-soft aria-pressed:font-medium aria-pressed:text-gold-ink",
  "price-tag:h-[30px] price-tag:px-3 price-tag:text-[13px] price-tag:hover:border-ink",
  "price-tag:aria-checked:border-ink price-tag:aria-checked:bg-ink price-tag:aria-checked:text-background price-tag:aria-pressed:border-ink price-tag:aria-pressed:bg-ink price-tag:aria-pressed:text-background"
)

// A toggle chip (pass `aria-pressed`) or a plain action chip.
function Chip({ className, ...props }: React.ComponentProps<"button">) {
  return <button type="button" data-slot="chip" className={cn(chipClass, className)} {...props} />
}

// A single-choice radio group of chips, such as the channel picker; each chip is a radio named by its label.
function ChipGroup<T extends string | number>({
  options,
  value,
  onValueChange,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  "aria-label": string
  options: Choice<T>[]
  value: T | null
  onValueChange(value: T): void
}) {
  return (
    <div role="radiogroup" data-slot="chip-group" className={cn("flex flex-wrap gap-1.5", className)} {...props}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={chipClass}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </button>
      ))}
      {children}
    </div>
  )
}

export { Chip, ChipGroup }
