import type { ReactNode } from 'react';
import {
  FolderTree,
  House,
  LogOut,
  Package,
  ScanText,
  SlidersHorizontal,
  SquarePen,
  Store,
  Tag,
  UserPlus,
  Users,
} from 'lucide-react';
import { BrandLogo } from '@/components/brand';
import { PageBar, PageBarProvider } from '@/components/ui/page';
import type { Me } from '@/lib/api';
import { Link } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export const sections = [
  { path: '/', label: '录入', group: 'daily', icon: SquarePen },
  { path: '/products', label: '商品', group: 'daily', icon: Package },
  { path: '/categories', label: '分类', group: 'daily', icon: FolderTree },
  { path: '/recognitions', label: '识别', group: 'daily', icon: ScanText },
  { path: '/channels', label: '渠道', group: 'daily', icon: Store },
  { path: '/promotions', label: '大促', group: 'daily', icon: Tag },
  { path: '/members', label: '成员', group: 'household', icon: Users, householdAdmin: true },
  { path: '/invitations', label: '邀请', group: 'household', icon: UserPlus, householdAdmin: true },
  { path: '/households', label: '家庭', group: 'instance', icon: House, instanceAdmin: true },
  { path: '/settings', label: '设置', group: 'account', icon: SlidersHorizontal },
] as const;

export type Section = (typeof sections)[number];
export type SectionPath = Section['path'];

const groupLabels: Record<Section['group'], string | null> = {
  daily: '日常',
  household: '家庭管理',
  instance: '实例',
  account: null,
};

export function canSee(me: Me, section: Section) {
  if ('householdAdmin' in section) return me.household.role === 'admin';
  if ('instanceAdmin' in section) return me.user.isInstanceAdmin;
  return true;
}

// Desktop: a fixed sidebar beside the content column. Phone: the same header becomes a top bar
// with the navigation as a scrolling strip, so both layouts share one set of landmarks and names.
export function AppShell({
  me,
  current,
  onSignOut,
  children,
}: {
  me: Me;
  current: SectionPath;
  onSignOut(): void;
  children: ReactNode;
}) {
  const visible = sections.filter((s) => canSee(me, s));
  const groups = (Object.keys(groupLabels) as Section['group'][])
    .map((group) => ({ group, items: visible.filter((s) => s.group === group) }))
    .filter((g) => g.items.length > 0);
  const title = sections.find((s) => s.path === current)?.label ?? '';

  return (
    <PageBarProvider>
      <div className="min-h-svh wide:grid wide:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]">
        <header
          className={cn(
            'bg-rail text-rail-ink border-rail-line grid grid-cols-[minmax(0,1fr)_auto] items-center border-b',
            'wide:sticky wide:top-0 wide:flex wide:h-svh wide:flex-col wide:items-stretch wide:border-r wide:border-b-0',
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5 px-4 py-2.5 wide:px-3 wide:pt-3 wide:pb-1.5 price-tag:wide:flex-col price-tag:wide:items-stretch price-tag:wide:gap-4 price-tag:wide:px-3 price-tag:wide:pt-[18px]">
            <span className="flex shrink-0 items-center gap-2 price-tag:wide:px-1.5">
              <BrandLogo />
              <span className="numeric text-rail-ink-strong hidden text-[21px] font-bold tracking-[.02em] price-tag:wide:inline">
                StockUp
              </span>
            </span>
            <span className="flex min-w-0 flex-col leading-tight price-tag:wide:border price-tag:wide:border-rail-avatar price-tag:wide:px-2.5 price-tag:wide:py-2">
              <span className="text-rail-ink-strong truncate text-[13px] font-semibold">{me.household.name}</span>
              <span className="text-rail-dim hidden text-[11px] wide:inline price-tag:wide:text-xs">
                {me.household.role === 'admin' ? '家庭管理员' : '家庭成员'}
              </span>
            </span>
          </div>

          <nav
            aria-label="主导航"
            className={cn(
              'col-span-2 row-start-2 flex gap-1 overflow-x-auto px-3 pb-2 whitespace-nowrap [scrollbar-width:none]',
              'wide:flex-1 wide:flex-col wide:gap-3.5 wide:overflow-y-auto wide:px-2.5 wide:pt-1.5 wide:pb-2.5',
              'price-tag:wide:gap-0 price-tag:wide:px-0',
            )}
          >
            {groups.map(({ group, items }) => (
              <div
                key={group}
                className={cn(
                  'contents wide:flex wide:flex-col wide:gap-px price-tag:wide:gap-0 price-tag:wide:pt-3.5',
                  group === 'account' && 'wide:mt-auto',
                )}
              >
                {groupLabels[group] && (
                  <p className="text-rail-dim hidden px-2 pt-1.5 pb-1 text-[11px] font-medium tracking-[.02em] wide:block price-tag:wide:px-[18px] price-tag:wide:pt-0 price-tag:wide:pb-1.5 price-tag:wide:tracking-[.14em]">
                    {groupLabels[group]}
                  </p>
                )}
                {items.map((s) => {
                  const Icon = s.icon;
                  return (
                    <Link
                      key={s.path}
                      href={s.path}
                      aria-current={s.path === current ? 'page' : undefined}
                      className={cn(
                        'text-rail-ink relative flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
                        'hover:bg-rail-hover hover:text-rail-ink-strong',
                        'aria-[current=page]:bg-rail-selected aria-[current=page]:text-rail-ink-strong aria-[current=page]:font-medium',
                        "wide:h-[30px] wide:px-2 wide:aria-[current=page]:before:bg-rail-marker wide:aria-[current=page]:before:absolute wide:aria-[current=page]:before:top-[7px] wide:aria-[current=page]:before:bottom-[7px] wide:aria-[current=page]:before:-left-2.5 wide:aria-[current=page]:before:w-0.5 wide:aria-[current=page]:before:rounded-full wide:aria-[current=page]:before:content-['']",
                        'price-tag:rounded-none price-tag:aria-[current=page]:font-semibold price-tag:wide:h-[34px] price-tag:wide:px-[18px] price-tag:wide:text-[13.5px]',
                        'price-tag:wide:aria-[current=page]:shadow-[inset_3px_0_0_var(--gold)] price-tag:wide:aria-[current=page]:before:hidden',
                        'price-tag:aria-[current=page]:shadow-[inset_0_-2px_0_var(--gold)]',
                      )}
                    >
                      <Icon
                        aria-hidden
                        className={cn(
                          'text-rail-dim hidden size-4 shrink-0 wide:block',
                          s.path === current && 'text-rail-ink-strong price-tag:text-gold',
                        )}
                      />
                      {s.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="col-start-2 row-start-1 flex items-center gap-2 px-3 wide:border-rail-line wide:border-t wide:px-2.5 wide:py-2.5 price-tag:wide:px-[18px]">
            <span
              aria-hidden
              className="hidden size-[26px] shrink-0 place-items-center rounded-full bg-rail-avatar text-rail-avatar-ink text-[11px] font-semibold wide:grid price-tag:rounded-[2px]"
            >
              {me.user.name.slice(0, 1)}
            </span>
            <span className="text-rail-ink-strong max-w-28 truncate text-[13px] font-medium wide:max-w-none wide:flex-1">
              {me.user.name}
            </span>
            <button
              type="button"
              aria-label="登出"
              title="登出"
              className="text-rail-dim hover:bg-rail-hover hover:text-rail-ink-strong grid size-8 shrink-0 place-items-center rounded-md transition-colors"
              onClick={onSignOut}
            >
              <LogOut aria-hidden className="size-4" />
            </button>
          </div>
        </header>

        <div data-slot="page-column" className="flex min-w-0 flex-col">
          <PageBar fallbackTitle={title} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </PageBarProvider>
  );
}
