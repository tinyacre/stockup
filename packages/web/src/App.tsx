import { Button } from '@/components/ui/button';

export function App() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">StockUp</h1>
      <p className="text-muted-foreground">家庭共享的好价记忆工具</p>
      <Button asChild variant="outline">
        <a href="/api/docs">API 文档</a>
      </Button>
    </main>
  );
}
