import * as React from "react"
import { formatYuan } from "@/lib/format"
import { cn } from "@/lib/utils"

const sizes = {
  sm: "text-num-sm",
  md: "text-num-md",
  lg: "text-num-lg",
  xl: "text-num-xl",
}

// `target` marks the Stock Line and `low` the lowest unit price; the price-tag theme highlights the target in gold.
const tones = {
  default: "text-ink",
  target:
    "text-ink price-tag:box-decoration-clone price-tag:bg-[linear-gradient(transparent_62%,var(--gold)_62%,var(--gold)_92%,transparent_92%)] price-tag:px-[3px]",
  low: "text-record-low",
}

// A yuan amount in the numeral face, optionally followed by the size it is priced per.
function PriceFigure({
  cents,
  per,
  tone = "default",
  size = "md",
  className,
  ...props
}: React.ComponentProps<"span"> & {
  cents: number
  per?: string
  tone?: keyof typeof tones
  size?: keyof typeof sizes
}) {
  return (
    <span data-slot="price-figure" className={cn("whitespace-nowrap", className)} {...props}>
      <span className={cn("numeric font-semibold", sizes[size], tones[tone])}>{formatYuan(cents)}</span>
      {per && <span className="text-xs text-ink-3"> / {per}</span>}
    </span>
  )
}

export { PriceFigure }
