import { AuthGate } from "@/components/AuthGate";
import { AccountControls } from "@/components/AccountControls";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <span aria-hidden className="mr-2">💡</span>
            光熱費トラッカー
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            電気(TEPCO)・ガス(LPIO)・水道(東京都水道局)の料金と使用量を集約し、月別推移・使用量/単価・前年同月比を可視化。
          </p>
        </div>
        <AccountControls />
      </header>

      <AuthGate>
        <Dashboard />
      </AuthGate>
    </main>
  );
}
