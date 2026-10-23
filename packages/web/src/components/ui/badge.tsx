import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import type { Verdict } from "@stockup/domain"
import { verdictLabels } from "@/lib/pricing"
import { cn } from "@/lib/utils"

// Verdict tones are soft tints in the tool theme and solid stamps in the price-tag theme.
const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] leading-none font-semibold whitespace-nowrap price-tag:text-xs price-tag:tracking-[.04em]",
  {
    variants: {
      tone: {
        neutral: "bg-surface-hover text-ink-2",
        outline: "text-ink-3 shadow-[inset_0_0_0_1px_var(--line-strong)] price-tag:font-medium",
        gold: "bg-gold-soft text-gold-ink price-tag:text-ink price-tag:shadow-[inset_2px_0_0_var(--gold-edge)]",
        recordLow: "bg-record-low-soft text-record-low price-tag:bg-record-low price-tag:text-on-verdict",
        stockUp: "bg-stock-up-soft text-stock-up price-tag:bg-stock-up price-tag:text-on-verdict",
        skip: "bg-skip-soft text-skip price-tag:bg-skip price-tag:text-on-verdict",
        noReference:
          "bg-skip-soft text-skip price-tag:bg-transparent price-tag:font-medium price-tag:shadow-[inset_0_0_0_1px_var(--line-strong)]",
      },
      size: {
        default: "",
        lg: "h-6 px-2.5 text-[13px] price-tag:h-7 price-tag:px-2 price-tag:text-sm",
      },
    },
    defaultVariants: { tone: "neutral", size: "default" },
  }
)

function Badge({ className, tone, size, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone, size }), className)} {...props} />
}

function VerdictBadge({ verdict, size, className }: { verdict: Verdict; size?: "default" | "lg"; className?: string }) {
  return (
    <Badge tone={verdict} size={size} className={className}>
      {verdictLabels[verdict]}
    </Badge>
  )
}

// 已购 is filled and 仅记录 is hollow, in both the dot (tool) and the stamp (price-tag).
function PurchaseBadge({ purchased, className }: { purchased: boolean; className?: string }) {
  return (
    <span
      data-slot="purchase-badge"
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[11px] leading-none font-semibold whitespace-nowrap shadow-[inset_0_0_0_1px_var(--line-strong)]",
        "before:size-1.5 before:rounded-full before:content-['']",
        purchased ? "bg-surface text-ink before:bg-ink-2" : "text-ink-3 before:border-[1.25px] before:border-ink-3",
        "price-tag:h-[22px] price-tag:text-xs price-tag:font-medium price-tag:before:hidden",
        purchased
          ? "price-tag:bg-ink price-tag:text-background price-tag:shadow-[inset_0_0_0_1px_var(--ink)]"
          : "price-tag:bg-surface price-tag:text-ink-2",
        className
      )}
    >
      {purchased ? "已购" : "仅记录"}
    </span>
  )
}

function PromotionTag({ className, ...props }: React.ComponentProps<"span">) {
  return <Badge tone="gold" className={cn("price-tag:numeric price-tag:font-semibold", className)} {...props} />
}

export { Badge, badgeVariants, VerdictBadge, PurchaseBadge, PromotionTag }
