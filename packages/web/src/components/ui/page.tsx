import * as React from "react"
import { ChevronRight } from "lucide-react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

const PageBarContext = React.createContext<HTMLElement | null>(null)

// The bar at the top of the content column. It shows `fallbackTitle` until a page renders a <PageHeader>.
function PageBar({ fallbackTitle }: { fallbackTitle: string }) {
  const [, setSlot] = React.useContext(PageBarSetterContext)
  return (
    <div
      ref={setSlot}
      data-slot="page-bar"
      className={cn(
        "flex min-h-12 items-center gap-3 border-b border-line bg-surface px-4 wide:sticky wide:top-0 wide:z-10 wide:h-(--page-bar-height) wide:px-(--gutter)",
        "price-tag:border-b-2 price-tag:border-rule price-tag:bg-background",
        "[&:has(>[data-slot=page-header])>[data-slot=page-bar-fallback]]:hidden",
        // On phones the navigation strip already names the section, so the bar shows only for a page's own header.
        "max-wide:[&:not(:has(>[data-slot=page-header]))]:hidden"
      )}
    >
      <h1 data-slot="page-bar-fallback" className={titleClass}>
        {fallbackTitle}
      </h1>
    </div>
  )
}

const PageBarSetterContext = React.createContext<[HTMLElement | null, (slot: HTMLElement | null) => void]>([
  null,
  () => {},
])

// Wraps the shell so pages anywhere below can fill the bar.
function PageBarProvider({ children }: { children: React.ReactNode }) {
  const state = React.useState<HTMLElement | null>(null)
  return (
    <PageBarSetterContext.Provider value={state}>
      <PageBarContext.Provider value={state[0]}>{children}</PageBarContext.Provider>
    </PageBarSetterContext.Provider>
  )
}

const titleClass =
  "min-w-0 truncate text-[15px] font-semibold wide:text-[13px] wide:font-medium price-tag:text-lg price-tag:font-semibold price-tag:tracking-[.04em] price-tag:wide:text-title-page"

export interface Crumb {
  label: React.ReactNode
  onClick?(): void
}

// The page's title and actions, shown in the shell's bar. Render it once per page. `crumbs` lead to the title
// and give way first when the bar runs out of room.
function PageHeader({
  title,
  crumbs,
  actions,
  className,
}: {
  title: React.ReactNode
  crumbs?: Crumb[]
  actions?: React.ReactNode
  className?: string
}) {
  const slot = React.useContext(PageBarContext)
  if (!slot) return null
  return createPortal(
    <div data-slot="page-header" className={cn("flex min-w-0 flex-1 items-center gap-3", className)}>
      <div className="flex min-w-0 items-center gap-1.5">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="路径" className="min-w-0 shrink-[100] overflow-hidden">
            <ol className="flex items-center gap-1.5 text-xs whitespace-nowrap text-ink-3 wide:text-[13px] price-tag:wide:text-sm">
              {crumbs.map((crumb, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  {crumb.onClick ? (
                    <button
                      type="button"
                      className="rounded-sm hover:text-ink focus-visible:shadow-focus"
                      onClick={crumb.onClick}
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span>{crumb.label}</span>
                  )}
                  <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-4" />
                </li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className={titleClass}>{title}</h1>
      </div>
      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </div>,
    slot
  )
}

// The page's own content area with the shell's gutter. `narrow` caps the line length for forms and settings.
function PageContent({
  width = "full",
  className,
  ...props
}: React.ComponentProps<"div"> & { width?: "full" | "narrow" }) {
  return (
    <div
      data-slot="page-content"
      className={cn(
        "flex flex-col gap-6 px-4 py-5 wide:px-(--gutter) wide:py-6",
        width === "narrow" && "max-w-[calc(40rem+2*var(--gutter))]",
        className
      )}
      {...props}
    />
  )
}

export { PageBar, PageBarProvider, PageHeader, PageContent }
