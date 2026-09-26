export function BrowserLoading() {
  return (
    <div className="min-h-svh flex flex-col bg-black">
      {/* Tab Bar Skeleton */}
      <div className="h-10 bg-black/80 border-b border-border flex items-center px-2 gap-1">
        <div className="h-8 w-32 bg-foreground/5 rounded-lg animate-pulse" />
        <div className="h-8 w-8 bg-foreground/5 rounded-lg animate-pulse" />
      </div>

      {/* Toolbar Skeleton */}
      <div className="h-12 bg-black/60 border-b border-border flex items-center px-3 gap-2">
        <div className="flex items-center gap-1">
          <div className="w-8 h-8 bg-foreground/5 rounded-lg animate-pulse" />
          <div className="w-8 h-8 bg-foreground/5 rounded-lg animate-pulse" />
          <div className="w-8 h-8 bg-foreground/5 rounded-lg animate-pulse" />
          <div className="w-8 h-8 bg-foreground/5 rounded-lg animate-pulse" />
        </div>
        <div className="flex-1 h-8 bg-foreground/5 rounded-full animate-pulse" />
        <div className="flex items-center gap-1">
          <div className="w-8 h-8 bg-foreground/5 rounded-lg animate-pulse" />
          <div className="w-8 h-8 bg-foreground/5 rounded-lg animate-pulse" />
        </div>
      </div>

      {/* Content Skeleton */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-foreground/5 animate-pulse" />
          <div className="w-32 h-4 bg-foreground/5 rounded animate-pulse" />
          <p className="text-foreground/40 text-sm">Inicializujem...</p>
        </div>
      </div>
    </div>
  )
}
