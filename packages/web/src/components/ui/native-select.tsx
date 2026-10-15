import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { controlClass } from "@/components/ui/input"

// A styled native <select>: it keeps the platform picker on phones and its own accessible name.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <span data-slot="native-select" className={cn("relative inline-flex min-w-0", className)}>
      <select
        className={cn(
          controlClass,
          "h-(--control-height) appearance-none pr-8 pl-2.5 text-base wide:text-[13px] price-tag:wide:text-sm"
        )}
        {...props}
      />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-3"
      />
    </span>
  )
}

export { NativeSelect }
