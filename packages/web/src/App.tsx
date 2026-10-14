import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError, type Me } from '@/lib/api';
import { CatalogPage } from '@/pages/catalog';
import { ChannelsPage } from '@/pages/channels';
import { HouseholdsPage } from '@/pages/households';
import { InvitationsPage } from '@/pages/invitations';
import { JoinPage } from '@/pages/join';
import { MembersPage } from '@/pages/members';
import { ProductPage } from '@/pages/product';
import { PromotionsPage } from '@/pages/promotions';
import { QuickPricePage } from '@/pages/quick-price';
import { SettingsPage } from '@/pages/settings';
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

function invitationInPath() {
  // Invitation IDs are UUIDs, so the path segment needs no decoding.
  return /^\/join\/([^/]+)$/.exec(window.location.pathname)?.[1];
}

export function App() {
  const [session, setSession] = useState<Session>({ state: 'loading' });
  const refresh = useCallback(() => loadSession().then(setSession), []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const signOut = () => api.signOut().finally(refresh);
  const leaveInvitation = () => {
    window.history.replaceState(null, '', '/');
    refresh();
  };
  const invitationId = invitationInPath();

  switch (session.state) {
    case 'loading':
      return null;
    case 'setup':
      return <SetupPage onDone={refresh} />;
    case 'signed-out':
      if (invitationId) return <JoinPage invitationId={invitationId} onDone={leaveInvitation} />;
      return <SignInPage onDone={refresh} />;
    case 'signed-in':
      if (invitationId) {
        return (
          <main className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-4 p-4 text-center">
            <p role="alert">
              你已经是「{session.me.household.name}」的成员，一个成员只能属于一个家庭。要用这个邀请注册新账号，请先登出。
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={leaveInvitation}>
                返回首页
              </Button>
              <Button variant="outline" onClick={signOut}>
                登出
              </Button>
            </div>
          </main>
        );
      }
      return <Home me={session.me} onSignOut={signOut} onSessionChange={refresh} />;
    case 'blocked':
      return (
        <main className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-4 p-4 text-center">
          <p role="alert">{session.message}</p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={refresh}>
              重试
            </Button>
            <Button variant="outline" onClick={signOut}>
              登出
            </Button>
          </div>
        </main>
      );
  }
}

const sections = [
  { path: '/', label: '算价' },
  { path: '/products', label: '商品' },
  { path: '/channels', label: '渠道' },
  { path: '/promotions', label: '大促' },
  { path: '/members', label: '成员', householdAdmin: true },
  { path: '/invitations', label: '邀请', householdAdmin: true },
  { path: '/households', label: '家庭', instanceAdmin: true },
  { path: '/settings', label: '设置' },
] as const;

type Section = (typeof sections)[number];

function canSee(me: Me, section: Section) {
  if ('householdAdmin' in section) return me.household.role === 'admin';
  if ('instanceAdmin' in section) return me.user.isInstanceAdmin;
  return true;
}

type SectionPath = Section['path'];

// A product page belongs to the catalog section.
interface Route {
  section: SectionPath;
  productId?: string;
}

function currentRoute(): Route {
  const path = window.location.pathname;
  const product = /^\/products\/([^/]+)$/.exec(path);
  if (product) return { section: '/products', productId: decodeURIComponent(product[1]!) };
  return { section: sections.find((s) => s.path === path)?.path ?? '/' };
}

function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onPopState = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  // The state travels with the history entry, so pages can restore what they showed there.
  const navigate = (path: string, state: unknown = null) => {
    if (path !== window.location.pathname) window.history.pushState(state, '', path);
    setRoute(currentRoute());
  };
  return [route, navigate] as const;
}

function Home({ me, onSignOut, onSessionChange }: { me: Me; onSignOut(): void; onSessionChange(): void }) {
  const [route, navigate] = useRoute();
  const { productId } = route;
  const visibleSections = sections.filter((s) => canSee(me, s));
  // A section the member may no longer see, as after handing over the admin role, shows quick price.
  const section = visibleSections.some((s) => s.path === route.section) ? route.section : '/';
  const openProduct = (id: string) => navigate(`/products/${encodeURIComponent(id)}`);
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
      <nav aria-label="主导航" className="flex gap-1 overflow-x-auto border-b px-4 whitespace-nowrap">
        {visibleSections.map((s) => (
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
      <main>
        {productId ? (
          <ProductPage
            key={productId}
            productId={productId}
            onBack={(categoryId) => navigate('/products', { categoryId })}
          />
        ) : section === '/channels' ? (
          <ChannelsPage />
        ) : section === '/promotions' ? (
          <PromotionsPage />
        ) : section === '/members' ? (
          <MembersPage meId={me.user.id} onRoleHandedOver={onSessionChange} />
        ) : section === '/invitations' ? (
          <InvitationsPage />
        ) : section === '/households' ? (
          <HouseholdsPage />
        ) : section === '/settings' ? (
          <SettingsPage me={me} onRenamed={onSessionChange} />
        ) : section === '/products' ? (
          <CatalogPage onOpenProduct={openProduct} />
        ) : (
          <QuickPricePage onOpenProduct={openProduct} />
        )}
      </main>
    </div>
  );
}
