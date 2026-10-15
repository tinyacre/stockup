import * as React from "react"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

// `item` lists are selectable rows (product pickers, trees); `ruled` lists are table-like records.
// The price-tag theme rules both.
function List({
  variant = "item",
  className,
  ...props
}: React.ComponentProps<"ul"> & { variant?: "item" | "ruled" }) {
  return (
    <ul
      data-slot="list"
      data-variant={variant}
      className={cn(
        "group/list flex flex-col",
        variant === "item" ? "gap-px px-2" : "divide-y divide-line",
        "price-tag:gap-0 price-tag:px-0 price-tag:divide-y-0 price-tag:[&>*]:border-b price-tag:[&>*]:border-line price-tag:[&>[data-slot=list-header]]:border-ink",
        className
      )}
      {...props}
    />
  )
}

// One row; render the interactive element through `asChild`. Marks itself selected from `aria-current`.
// `inset` rows are a tree's children: their content lines up with the parent row's label after its 16px icon.
function ListRow({
  className,
  asChild,
  inset,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean; inset?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      data-slot="list-row"
      className={cn(
        "relative flex min-w-0 items-center gap-2.5 text-left transition-colors",
        "rounded-md px-2 py-2 hover:bg-surface-hover",
        "group-data-[variant=ruled]/list:min-h-12 group-data-[variant=ruled]/list:rounded-none group-data-[variant=ruled]/list:px-4 group-data-[variant=ruled]/list:hover:bg-surface-subtle",
        "selected:bg-surface-selected",
        "selected:before:absolute selected:before:top-2.5 selected:before:bottom-2.5 selected:before:-left-2 selected:before:w-0.5 selected:before:rounded-full selected:before:bg-gold selected:before:content-['']",
        "price-tag:rounded-none price-tag:px-5 price-tag:py-2.5 price-tag:group-data-[variant=ruled]/list:min-h-14 price-tag:group-data-[variant=ruled]/list:px-1 price-tag:group-data-[variant=ruled]/list:hover:bg-surface-hover",
        "price-tag:selected:shadow-[inset_3px_0_0_var(--ink)] price-tag:selected:before:hidden",
        inset && "pl-[30px] price-tag:pl-[42px]",
        className
      )}
      {...props}
    />
  )
}

// Column heads of a `ruled` list, laid out like its rows; screen readers get each row's own labels instead.
function ListHeader({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      aria-hidden
      data-slot="list-header"
      className={cn(
        "flex min-h-9 items-center gap-2.5 bg-surface-subtle px-4 text-[11px] font-medium tracking-[.02em] text-ink-3",
        "price-tag:min-h-[34px] price-tag:bg-transparent price-tag:px-1 price-tag:text-xs price-tag:font-normal price-tag:tracking-[.08em]",
        className
      )}
      {...props}
    />
  )
}

// A column of a `ruled` list. Figure columns line up on their right edge in the price-tag theme.
function ListCell({
  className,
  asChild,
  figure,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean; figure?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      data-slot="list-cell"
      className={cn("min-w-0", figure && "flex flex-col items-start price-tag:items-end price-tag:text-right", className)}
      {...props}
    />
  )
}

export { List, ListRow, ListHeader, ListCell }
