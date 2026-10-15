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
        "price-tag:gap-0 price-tag:px-0 price-tag:divide-y-0 price-tag:[&>*]:border-b price-tag:[&>*]:border-line",
        className
      )}
      {...props}
    />
  )
}

// One row; render the interactive element through `asChild`. Marks itself selected from `aria-current`.
function ListRow({ className, asChild, ...props }: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      data-slot="list-row"
      className={cn(
        "relative flex min-w-0 items-center gap-2.5 text-left transition-colors",
        "rounded-md px-2 py-2 hover:bg-surface-hover",
        "group-data-[variant=ruled]/list:min-h-12 group-data-[variant=ruled]/list:rounded-none group-data-[variant=ruled]/list:px-4 group-data-[variant=ruled]/list:hover:bg-surface-subtle",
        "aria-[current=page]:bg-surface-selected aria-[current=true]:bg-surface-selected",
        "aria-[current=page]:before:absolute aria-[current=true]:before:absolute before:top-2.5 before:bottom-2.5 before:-left-2 before:w-0.5 before:rounded-full before:bg-gold aria-[current=page]:before:content-[''] aria-[current=true]:before:content-['']",
        "price-tag:rounded-none price-tag:px-5 price-tag:py-2.5 price-tag:group-data-[variant=ruled]/list:min-h-14 price-tag:group-data-[variant=ruled]/list:px-1 price-tag:group-data-[variant=ruled]/list:hover:bg-surface-hover",
        "price-tag:aria-[current=page]:shadow-[inset_3px_0_0_var(--ink)] price-tag:aria-[current=true]:shadow-[inset_3px_0_0_var(--ink)] price-tag:before:hidden",
        className
      )}
      {...props}
    />
  )
}

export { List, ListRow }
