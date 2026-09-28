import { AuthGate } from "@/components/AuthGate";
import { AccountControls } from "@/components/AccountControls";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">
            <span aria-hidden className="mr-2">💡</span>
            光熱費トラッカー
          </h1>
        </div>
        <AccountControls />
      </header>

      <AuthGate>
        <Dashboard />
      </AuthGate>
    </main>
  );
}
