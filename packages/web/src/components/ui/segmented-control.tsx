import * as React from "react"
import { cn } from "@/lib/utils"

export interface Choice<T> {
  value: T
  label: React.ReactNode
}

// A single-choice radio group drawn as a segmented switch; each option is a radio named by its label.
function SegmentedControl<T extends string | number | boolean>({
  options,
  value,
  onValueChange,
  size = "default",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  "aria-label": string
  options: Choice<T>[]
  value: T
  onValueChange(value: T): void
  size?: "default" | "sm"
}) {
  return (
    <div
      role="radiogroup"
      data-slot="segmented-control"
      className={cn(
        "inline-flex shrink-0 gap-0.5 rounded-md border border-line-strong bg-surface-subtle p-0.5",
        "price-tag:gap-0 price-tag:overflow-hidden price-tag:border-ink price-tag:bg-transparent price-tag:p-0",
        className
      )}
      {...props}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={cn(
            "rounded-[calc(var(--radius)-2px)] px-3 font-medium whitespace-nowrap text-ink-2 transition-colors outline-none hover:text-ink focus-visible:shadow-focus",
            size === "sm" ? "h-[22px] px-2.5 text-[11px]" : "h-[26px] text-xs",
            "aria-checked:bg-surface aria-checked:text-ink aria-checked:shadow-[0_0_0_1px_var(--line-strong)]",
            "price-tag:rounded-none price-tag:font-normal price-tag:text-ink price-tag:[&+&]:border-l price-tag:[&+&]:border-ink",
            size === "sm"
              ? "price-tag:h-[26px] price-tag:text-[12.5px]"
              : "price-tag:h-[30px] price-tag:px-3.5 price-tag:text-[13px]",
            "price-tag:aria-checked:bg-ink price-tag:aria-checked:font-medium price-tag:aria-checked:text-background price-tag:aria-checked:shadow-none"
          )}
          onClick={() => onValueChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export { SegmentedControl }
