import * as React from "react"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

// A labelled control with optional helper text; the label points at the control through `htmlFor`.
function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: React.ReactNode
  htmlFor: string
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div data-slot="field" className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

export { Field }
