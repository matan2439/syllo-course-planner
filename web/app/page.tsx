export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-md w-full space-y-6 text-center">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">
            מתכנן לימודים — TAU
          </h1>
          <p className="text-gray-500 text-sm">
            אוניברסיטת תל אביב
          </p>
        </div>

        <div className="rounded-xl border border-purple-100 bg-purple-50 px-6 py-4">
          <p className="text-purple-700 font-medium text-sm">
            גרסת האינטרנט בפיתוח
          </p>
          <p className="text-purple-500 text-xs mt-1">
            Web interface coming soon
          </p>
        </div>

        <p className="text-xs text-gray-400">
          Step 0 — Next.js skeleton
        </p>
      </div>
    </main>
  )
}
