import * as React from "react"
import { Slot } from "radix-ui"
import { cn } from "@/lib/utils"

// A bordered card in the tool theme; an open ledger section under a heavy rule in the price-tag theme.
function Panel({ className, asChild, ...props }: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "div"
  return (
    <Comp
      data-slot="panel"
      className={cn(
        "flex min-w-0 flex-col rounded-md border border-line bg-surface",
        "price-tag:rounded-none price-tag:border-0 price-tag:bg-transparent price-tag:not-has-[>[data-slot=panel-header]]:border-t-2 price-tag:not-has-[>[data-slot=panel-header]]:border-rule",
        className
      )}
      {...props}
    />
  )
}

// `leading` sits before the heading, outside it, so a control there stays out of the heading's name.
function PanelHeader({
  title,
  count,
  leading,
  actions,
  as: Heading = "h2",
  className,
  children,
}: {
  title: React.ReactNode
  count?: React.ReactNode
  leading?: React.ReactNode
  actions?: React.ReactNode
  as?: "h2" | "h3" | "h4"
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="panel-header"
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-2.5",
        "price-tag:border-b-2 price-tag:border-rule price-tag:px-0",
        className
      )}
    >
      {leading}
      <Heading className="flex items-baseline gap-2 text-[13px] font-semibold price-tag:text-[15px] price-tag:tracking-[.06em]">
        {title}
        {count !== undefined && (
          <span className="text-xs font-normal text-ink-3 price-tag:numeric price-tag:text-[17px] price-tag:font-medium price-tag:tracking-normal">
            {count}
          </span>
        )}
      </Heading>
      {children}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}

function PanelBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="panel-body" className={cn("px-(--panel-padding) py-4", className)} {...props} />
}

function PanelFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-footer"
      className={cn("flex items-center gap-2 border-t border-line px-(--panel-padding) py-3", className)}
      {...props}
    />
  )
}

export { Panel, PanelHeader, PanelBody, PanelFooter }
