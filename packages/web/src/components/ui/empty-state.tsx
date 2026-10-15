import * as React from "react"
import { cn } from "@/lib/utils"

// A short title with an optional action; it fills and centers within its container.
function EmptyState({
  title,
  icon,
  action,
  className,
}: {
  title: React.ReactNode
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center", className)}
    >
      <span
        aria-hidden
        className="grid size-11 place-items-center rounded-md border border-dashed border-line-strong bg-surface text-ink-3 price-tag:h-[30px] price-tag:border-[1.5px] price-tag:bg-transparent [&_svg]:size-5 price-tag:[&_svg]:hidden"
      >
        {icon}
      </span>
      <p className="text-sm font-medium text-ink-2 price-tag:text-[15px] price-tag:tracking-[.06em]">{title}</p>
      {action}
    </div>
  )
}

export { EmptyState }
