import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { List, ListCell, ListRow } from '@/components/ui/list';
import { PageContent, PageHeader } from '@/components/ui/page';
import { Panel, PanelHeader } from '@/components/ui/panel';
import { attempt, ConfirmButton, describeError, ListSkeleton, RetryAlert } from '@/components/editing';
import { api, type Member } from '@/lib/api';

const gone = { not_found: '该成员已不在家庭中' };

// Handing over the admin role changes what the signed-in member may see, so `onRoleHandedOver` reloads the session.
export function MembersPage({ meId, onRoleHandedOver }: { meId: string; onRoleHandedOver(): void }) {
  const [members, setMembers] = useState<Member[]>();
  const [loadError, setLoadError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setMembers(await api.members());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeError(error));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <PageContent>
      <PageHeader title="成员" />
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
                          onRoleHandedOver();
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
