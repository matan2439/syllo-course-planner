export default function BoardLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6" aria-busy>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex animate-pulse flex-col gap-2.5">
            <div className="h-6 rounded-md bg-black/[.05] dark:bg-white/[.06]" />
            {Array.from({ length: 3 }).map((_, j) => (
              <div
                key={j}
                className="h-20 rounded-xl bg-black/[.04] dark:bg-white/[.05]"
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
