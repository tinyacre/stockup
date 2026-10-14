import { useCallback, useEffect, useState } from 'react';
import { attempt, ConfirmButton, describeError, RetryAlert } from '@/components/editing';
import { api, type Member } from '@/lib/api';

const gone = { not_found: '这位成员已经不在家庭中了。' };

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
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4">
      <div>
        <h2 className="text-xl font-semibold">成员</h2>
        <p className="text-muted-foreground text-sm">
          被移除的成员会立即登出，不能再查看家庭的数据；他们录入的价格记录会保留。新成员通过邀请链接加入。
        </p>
      </div>
      {loadError && <RetryAlert message={`成员加载失败：${loadError}`} onRetry={reload} />}
      {members && (
        <ul aria-label="家庭成员" className="flex flex-col gap-2">
          {members.map((member) => (
            <li key={member.id} className="flex flex-wrap items-center gap-1 rounded-lg border px-3 py-2">
              <div className="mr-auto">
                <p>
                  {member.name}
                  {member.role === 'admin' && <span className="text-muted-foreground ml-2 text-xs">管理员</span>}
                </p>
                <p className="text-muted-foreground text-xs">{member.username}</p>
              </div>
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
          ))}
        </ul>
      )}
    </div>
  );
}
