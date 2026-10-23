import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { List, ListCell, ListRow } from '@/components/ui/list';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { attempt, ConfirmButton, ListSkeleton, NameForm, RetryAlert } from '@/components/editing';
import { api } from '@/lib/api';
import { loadErrorOf, queries, useRefresh } from '@/lib/queries';

const gone = { not_found: '该成员已不在家庭中' };

// Handing over the admin role changes what the signed-in member may see, and the header shows the household's name,
// so `onSessionChange` reloads the session after either.
export function MembersPage({
  meId,
  householdName,
  onSessionChange,
}: {
  meId: string;
  householdName: string;
  onSessionChange(): void;
}) {
  const loaded = useQuery(queries.members());
  const members = loaded.data;
  const loadError = loadErrorOf(loaded.error);
  const reload = useRefresh();

  return (
    <PageContent>
      <PageHeader title="成员" />
      <Panel asChild>
        <section aria-label="家庭名称">
          <PanelHeader title="家庭名称" />
          <PanelBody>
            <NameForm
              key={householdName}
              label="家庭名称"
              submitLabel="保存"
              defaultValue={householdName}
              onSubmit={async (name) => {
                const message = await attempt(() => api.renameHousehold({ name }));
                if (!message) onSessionChange();
                return message;
              }}
            />
          </PanelBody>
        </section>
      </Panel>
      {loadError && <RetryAlert message={`加载失败：${loadError}`} onRetry={reload} />}
      <Panel>
        <PanelHeader title="家庭成员" count={members?.length} />
        {!members && <ListSkeleton />}
        {members?.length === 0 && <EmptyState title="暂无成员" />}
        {members && members.length > 0 && (
          <List variant="ruled" aria-label="家庭成员">
            {members.map((member) => (
              <ListRow key={member.id} asChild className="flex-wrap gap-1 py-2">
                <li>
                  <ListCell lead>
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {member.name}
                      {member.role === 'admin' && <Badge tone="outline">管理员</Badge>}
                    </p>
                    <p className="text-xs text-ink-3">{member.username}</p>
                  </ListCell>
                  {member.id !== meId && (
                    <>
                      <ConfirmButton
                        label="设为管理员"
                        confirmLabel="确认转交"
                        ariaLabel={`把管理员转交给 ${member.name}`}
                        onConfirm={async () => {
                          const message = await attempt(() => api.makeAdmin(member.id), gone);
                          if (message) return message;
                          onSessionChange();
                        }}
                      />
                      <ConfirmButton
                        label="移除"
                        confirmLabel="确认移除"
                        ariaLabel={`移除 ${member.name}`}
                        onConfirm={async () => {
                          const message = await attempt(() => api.removeMember(member.id), gone);
                          await reload();
                          return message;
                        }}
                      />
                    </>
                  )}
                </li>
              </ListRow>
            ))}
          </List>
        )}
      </Panel>
    </PageContent>
  );
}
