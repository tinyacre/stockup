import { Toaster as Sonner } from "sonner"

function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      duration={3000}
      gap={8}
      offset={{ bottom: 24 }}
      mobileOffset={{ bottom: "calc(16px + env(safe-area-inset-bottom))", left: 16, right: 16 }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-full items-center gap-3 rounded-md bg-ink px-4 py-3 text-sm text-background shadow-lg wide:w-[356px] price-tag:rounded-none",
          title: "flex-1 font-medium",
          description: "text-xs opacity-80",
          icon: "size-4 shrink-0 [&>svg]:size-4",
          error: "bg-destructive text-white",
          actionButton:
            "shrink-0 rounded-sm px-2 py-1 text-sm font-semibold text-gold hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-gold",
          cancelButton: "shrink-0 rounded-sm px-2 py-1 text-sm opacity-80 hover:bg-white/10",
        },
      }}
    />
  )
}

export { Toaster }
