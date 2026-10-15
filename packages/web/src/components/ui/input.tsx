import * as React from "react"
import { cn } from "@/lib/utils"

// Shared by every boxed control, so inputs, selects and textareas line up.
const controlClass =
  "w-full min-w-0 rounded-md border border-line-strong bg-surface text-ink transition-[border-color,box-shadow] outline-none placeholder:text-ink-4 hover:border-ink-4 focus-visible:border-ring focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive price-tag:hover:border-ink-3"

const bodyText = "text-base wide:text-[13px] price-tag:wide:text-sm"

// Numbers typed in the numeral face; `lg` is a form's main figures. Phone sizes stay at 16px or more so iOS keeps its zoom.
const figureText = {
  lg: "numeric text-[17px] font-semibold price-tag:text-[21px] price-tag:font-medium",
  md: "numeric text-base font-semibold wide:text-[15px] price-tag:text-[17px] price-tag:font-medium price-tag:wide:text-[17px]",
  sm: "numeric text-base wide:text-[15px]",
}

type FigureSize = keyof typeof figureText

// 1Password offers to fill every text field; only account fields hold something it should fill.
const credentialFields = /\b(username|current-password|new-password|one-time-code)$/

function passwordManagerProps(autoComplete: string | undefined) {
  return autoComplete && credentialFields.test(autoComplete) ? {} : { "data-1p-ignore": true }
}

function Input({ className, type, figure, ...props }: React.ComponentProps<"input"> & { figure?: FigureSize }) {
  return (
    <input
      type={type}
      data-slot="input"
      {...passwordManagerProps(props.autoComplete)}
      className={cn(
        controlClass,
        "h-(--control-height) px-2.5",
        figure ? figureText[figure] : bodyText,
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      data-1p-ignore
      className={cn(controlClass, "min-h-16 px-2.5 py-1.5", bodyText, className)}
      {...props}
    />
  )
}

// A boxed row around a bare input with icons, units or a <Kbd> beside it; focus styles follow the inner input.
function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        controlClass,
        "flex h-(--control-height) items-center gap-2 px-2.5 text-ink-3 has-[input:focus-visible]:border-ring has-[input:focus-visible]:shadow-focus [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({ className, figure, ...props }: React.ComponentProps<"input"> & { figure?: FigureSize }) {
  return (
    <input
      data-slot="input-group-input"
      {...passwordManagerProps(props.autoComplete)}
      className={cn(
        "h-full w-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-4",
        figure ? figureText[figure] : bodyText,
        className
      )}
      {...props}
    />
  )
}

// A unit or label inside an InputGroup; `boxed` draws it as a separate cell at the row's end.
function InputAddon({ className, boxed, ...props }: React.ComponentProps<"span"> & { boxed?: boolean }) {
  return (
    <span
      data-slot="input-addon"
      className={cn(
        "shrink-0 text-xs whitespace-nowrap text-ink-3",
        boxed && "-mr-2.5 flex items-center self-stretch rounded-r-md border-l border-line bg-surface-subtle px-2.5 text-ink-2",
        className
      )}
      {...props}
    />
  )
}

export { Input, Textarea, InputGroup, InputGroupInput, InputAddon, controlClass }
