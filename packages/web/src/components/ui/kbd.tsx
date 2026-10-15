import * as React from "react"
import { cn } from "@/lib/utils"

function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-md border border-b-2 border-line-strong bg-surface px-1.5 font-sans text-[11px] font-medium text-ink-3 price-tag:numeric price-tag:h-5 price-tag:min-w-5 price-tag:bg-background price-tag:text-xs price-tag:text-ink-2",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
