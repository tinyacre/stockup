import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppShell, canSee, sections, type SectionPath } from '@/components/app-shell';
import { AuthLayout } from '@/components/auth-form';
import { BrandLogo } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Panel } from '@/components/ui/panel';
import { api, ApiError, type Me } from '@/lib/api';
import { applyTheme } from '@/lib/theme';
import { CatalogPage } from '@/pages/catalog';
import { ChannelsPage } from '@/pages/channels';
import { ConsentPage } from '@/pages/consent';
import { HouseholdsPage } from '@/pages/households';
import { InvitationsPage } from '@/pages/invitations';
import { JoinPage } from '@/pages/join';
import { MembersPage } from '@/pages/members';
import { ProductPage } from '@/pages/product';
import { PromotionsPage } from '@/pages/promotions';
import { QuickPricePage } from '@/pages/quick-price';
import { RecognitionPage, RecognitionUploadPage } from '@/pages/recognition';
import { SettingsPage } from '@/pages/settings';
import { SetupPage } from '@/pages/setup';
import { SignInPage } from '@/pages/sign-in';

type Session =
  | { state: 'loading' }
  | { state: 'setup' }
  | { state: 'signed-out' }
  | { state: 'signed-in'; me: Me }
  | { state: 'no-household' }
  | { state: 'blocked'; message: string };

async function loadSession(): Promise<Session> {
  try {
    if ((await api.setupStatus()).needsSetup) return { state: 'setup' };
    return { state: 'signed-in', me: await api.me() };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { state: 'signed-out' };
    if (error instanceof ApiError && error.code === 'no_household') return { state: 'no-household' };
    return { state: 'blocked', message: '暂时无法连接 StockUp，请稍后再试。' };
  }
}

function invitationInPath() {
  // Invitation IDs are UUIDs, so the path segment needs no decoding.
  return /^\/join\/([^/]+)$/.exec(window.location.pathname)?.[1];
}

// Better Auth sends an MCP client's authorization request here with a signed query, which these pages hand back.
function authorizationPage() {
  const { pathname, search } = window.location;
  if (pathname === '/oauth/sign-in') return { page: 'sign-in' as const, oauthQuery: search.slice(1) };
  if (pathname === '/oauth/consent') return { page: 'consent' as const, oauthQuery: search.slice(1) };
}

export function App() {
  const [session, setSession] = useState<Session>({ state: 'loading' });
  // An invitee who already has an account signs in before using the invitation with it.
  const [signingInToJoin, setSigningInToJoin] = useState(false);
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
  const authorization = authorizationPage();

  if (authorization?.page === 'sign-in') return <SignInPage oauthQuery={authorization.oauthQuery} onDone={refresh} />;
  if (authorization?.page === 'consent') return <ConsentPage oauthQuery={authorization.oauthQuery} />;

  switch (session.state) {
    case 'loading':
      return (
        <div className="grid min-h-svh place-items-center">
          <BrandLogo className="animate-pulse" />
        </div>
      );
    case 'setup':
      return <SetupPage onDone={refresh} />;
    case 'signed-out':
      if (invitationId && !signingInToJoin) {
        return <JoinPage invitationId={invitationId} onDone={leaveInvitation} onSignIn={() => setSigningInToJoin(true)} />;
      }
      return <SignInPage onDone={refresh} />;
    case 'signed-in':
      if (invitationId) {
        return (
          <SessionNotice
            message={`你已经是「${session.me.household.name}」的成员，一个成员只能属于一个家庭。要用这个邀请注册新账号，请先登出。`}
          >
            <Button variant="outline" onClick={leaveInvitation}>
              返回首页
            </Button>
            <Button variant="outline" onClick={signOut}>
              登出
            </Button>
          </SessionNotice>
        );
      }
      return <Home me={session.me} onSignOut={signOut} onSessionChange={refresh} />;
    case 'no-household':
      if (invitationId) return <JoinPage invitationId={invitationId} signedIn onDone={leaveInvitation} />;
      return (
        <SessionNotice message="你已不属于任何家庭。向家庭管理员要一个邀请链接，打开后可以用当前账号重新加入。">
          <Button variant="outline" onClick={refresh}>
            重试
          </Button>
          <Button variant="outline" onClick={signOut}>
            登出
          </Button>
        </SessionNotice>
      );
    case 'blocked':
      return (
        <SessionNotice message={session.message}>
          <Button variant="outline" onClick={refresh}>
            重试
          </Button>
          <Button variant="outline" onClick={signOut}>
            登出
          </Button>
        </SessionNotice>
      );
  }
}

function SessionNotice({ message, children }: { message: string; children: ReactNode }) {
  return (
    <AuthLayout>
      <Panel className="items-center gap-4 p-6 text-center price-tag:bg-surface">
        <p role="alert">{message}</p>
        <div className="flex gap-2">{children}</div>
      </Panel>
    </AuthLayout>
  );
}

// A product page belongs to the catalog section, and a recognition to the recognition section.
interface Route {
  section: SectionPath;
  productId?: string;
  recognitionId?: string;
}

function currentRoute(): Route {
  const path = window.location.pathname;
  const product = /^\/products\/([^/]+)$/.exec(path);
  if (product) return { section: '/products', productId: decodeURIComponent(product[1]!) };
  const recognition = /^\/recognitions\/([^/]+)$/.exec(path);
  if (recognition) return { section: '/recognitions', recognitionId: decodeURIComponent(recognition[1]!) };
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
  const { productId, recognitionId } = route;
  // A section the member may no longer see, as after handing over the admin role, shows quick price.
  const section = sections.some((s) => s.path === route.section && canSee(me, s)) ? route.section : '/';
  const openProduct = (id: string) => navigate(`/products/${encodeURIComponent(id)}`);
  useEffect(() => applyTheme(me.user.theme), [me.user.theme]);
  return (
    <AppShell me={me} current={section} onNavigate={navigate} onSignOut={onSignOut}>
      {productId ? (
        <ProductPage
          key={productId}
          productId={productId}
          onBack={(categoryId) => navigate('/products', { categoryId })}
        />
      ) : recognitionId ? (
        <RecognitionPage
          key={recognitionId}
          recognitionId={recognitionId}
          onManualEntry={() => navigate('/')}
          onOpenProduct={openProduct}
          onUploadAnother={() => navigate('/recognitions')}
        />
      ) : section === '/recognitions' ? (
        <RecognitionUploadPage onStarted={(id) => navigate(`/recognitions/${encodeURIComponent(id)}`)} />
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
    </AppShell>
  );
}
