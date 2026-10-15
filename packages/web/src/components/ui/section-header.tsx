import * as React from "react"
import { cn } from "@/lib/utils"

// A small label heading for a group of fields or a column; `ruled` opens the group with a rule above.
function SectionHeader({
  title,
  count,
  actions,
  ruled,
  as: Heading = "h3",
  className,
}: {
  title: React.ReactNode
  count?: React.ReactNode
  actions?: React.ReactNode
  ruled?: boolean
  as?: "h2" | "h3" | "h4"
  className?: string
}) {
  return (
    <div
      data-slot="section-header"
      className={cn(
        "flex items-baseline justify-between gap-3 pb-1.5",
        ruled && "mt-4 border-t border-line pt-3 price-tag:border-t-2 price-tag:border-rule",
        className
      )}
    >
      <Heading className="flex items-baseline gap-1.5 text-title-section font-semibold tracking-[.02em] text-ink-3 price-tag:font-medium price-tag:tracking-[.12em]">
        {title}
        {count !== undefined && (
          <span className="font-normal price-tag:numeric price-tag:text-[13px] price-tag:tracking-normal">{count}</span>
        )}
      </Heading>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export { SectionHeader }
