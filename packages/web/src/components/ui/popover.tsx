import * as React from "react"
import { Popover as Primitive } from "radix-ui"
import { cn } from "@/lib/utils"

const Popover = Primitive.Root
const PopoverTrigger = Primitive.Trigger

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-h-(--radix-popover-content-available-height) overflow-y-auto rounded-md border border-line bg-surface p-3 shadow-overlay outline-none duration-150",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          "price-tag:rounded-none price-tag:border-2 price-tag:border-ink",
          className
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent }
