import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError, type Me } from '@/lib/api';
import { CatalogPage } from '@/pages/catalog';
import { ChannelsPage } from '@/pages/channels';
import { SetupPage } from '@/pages/setup';
import { SignInPage } from '@/pages/sign-in';

type Session =
  | { state: 'loading' }
  | { state: 'setup' }
  | { state: 'signed-out' }
  | { state: 'signed-in'; me: Me }
  | { state: 'blocked'; message: string };

async function loadSession(): Promise<Session> {
  try {
    if ((await api.setupStatus()).needsSetup) return { state: 'setup' };
    return { state: 'signed-in', me: await api.me() };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { state: 'signed-out' };
    if (error instanceof ApiError && error.status === 403) {
      return { state: 'blocked', message: '你已不属于任何家庭，请联系家庭管理员。' };
    }
    return { state: 'blocked', message: '暂时无法连接 StockUp，请稍后再试。' };
  }
}

export function App() {
  const [session, setSession] = useState<Session>({ state: 'loading' });
  const refresh = useCallback(() => loadSession().then(setSession), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  switch (session.state) {
    case 'loading':
      return null;
    case 'setup':
      return <SetupPage onDone={refresh} />;
    case 'signed-out':
      return <SignInPage onDone={refresh} />;
    case 'signed-in':
      return <Home me={session.me} onSignOut={() => api.signOut().finally(refresh)} />;
    case 'blocked':
      return (
        <main className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-4 p-4 text-center">
          <p role="alert">{session.message}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={refresh}>
              重试
            </Button>
            <Button variant="outline" onClick={() => api.signOut().finally(refresh)}>
              登出
            </Button>
          </div>
        </main>
      );
  }
}

const sections = [
  { path: '/', label: '商品' },
  { path: '/channels', label: '渠道' },
] as const;

type SectionPath = (typeof sections)[number]['path'];

function currentSection(): SectionPath {
  return sections.find((s) => s.path === window.location.pathname)?.path ?? '/';
}

function useSection() {
  const [section, setSection] = useState(currentSection);
  useEffect(() => {
    const onPopState = () => setSection(currentSection());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const navigate = (path: SectionPath) => {
    if (path !== section) window.history.pushState(null, '', path);
    setSection(path);
  };
  return [section, navigate] as const;
}

function Home({ me, onSignOut }: { me: Me; onSignOut(): void }) {
  const [section, navigate] = useSection();
  return (
    <div className="min-h-svh">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">StockUp</h1>
          <p className="text-muted-foreground text-sm">{me.household.name}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">{me.user.name}</span>
          <Button variant="outline" size="sm" onClick={onSignOut}>
            登出
          </Button>
        </div>
      </header>
      <nav aria-label="主导航" className="flex gap-1 border-b px-4">
        {sections.map((s) => (
          <a
            key={s.path}
            href={s.path}
            aria-current={s.path === section ? 'page' : undefined}
            className="text-muted-foreground aria-[current]:border-foreground aria-[current]:text-foreground -mb-px border-b-2 border-transparent px-3 py-2 text-sm"
            onClick={(event) => {
              event.preventDefault();
              navigate(s.path);
            }}
          >
            {s.label}
          </a>
        ))}
      </nav>
      <main>{section === '/channels' ? <ChannelsPage /> : <CatalogPage />}</main>
    </div>
  );
}
