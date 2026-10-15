import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent font-medium whitespace-nowrap transition-colors outline-none focus-visible:border-ring focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-gold-edge bg-gold text-on-gold hover:bg-gold-hover price-tag:font-semibold",
        destructive: "bg-record-low text-on-verdict hover:bg-record-low/90",
        outline:
          "border-line-strong bg-surface text-ink hover:bg-surface-hover price-tag:border-ink price-tag:bg-transparent [&_svg]:text-ink-2",
        secondary: "bg-surface-hover text-ink hover:bg-surface-selected",
        ghost: "text-ink-2 hover:bg-surface-hover hover:text-ink",
        link: "h-auto! border-0 px-0! text-ink underline decoration-gold decoration-2 underline-offset-4",
      },
      size: {
        default: "h-(--control-height) px-3 text-[13px] price-tag:px-3.5 price-tag:text-sm",
        xs: "h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 px-2.5 text-xs",
        lg: "h-10 px-5 text-sm font-semibold price-tag:h-12 price-tag:text-[15px]",
        icon: "size-(--control-height)",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
