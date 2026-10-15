import { useEffect, useState } from 'react';
import { AuthForm, AuthLayout, AuthNotice } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { describeError } from '@/components/editing';
import { api, ApiError } from '@/lib/api';

const unusable: Record<string, string> = {
  not_found: '邀请链接不存在',
  invitation_used: '邀请链接已被使用',
  invitation_revoked: '邀请链接已作废',
  invitation_expired: '邀请链接已过期',
};

type Invitation =
  | { state: 'loading' }
  | { state: 'ready'; householdName: string; invitedBy: string }
  | { state: 'error'; message: string };

// A signed-in account without a household joins as itself; anyone else registers a new account.
export function JoinPage({
  invitationId,
  signedIn = false,
  onDone,
  onSignIn,
}: {
  invitationId: string;
  signedIn?: boolean;
  onDone(): void;
  onSignIn?(): void;
}) {
  const [invitation, setInvitation] = useState<Invitation>({ state: 'loading' });
  useEffect(() => {
    api.describeInvitation(invitationId).then(
      (found) => setInvitation({ state: 'ready', ...found }),
      (error) => setInvitation({ state: 'error', message: describeError(error, unusable) }),
    );
  }, [invitationId]);

  if (invitation.state === 'loading') {
    return (
      <AuthLayout>
        <Skeleton className="h-64 w-full" />
      </AuthLayout>
    );
  }
  if (invitation.state === 'error') {
    return (
      <AuthLayout>
        <AuthNotice>{invitation.message}</AuthNotice>
      </AuthLayout>
    );
  }

  const title = `加入「${invitation.householdName}」`;
  if (signedIn) {
    return (
      <AuthLayout>
        <AuthForm
          title={title}
          description={`${invitation.invitedBy} 邀请`}
          submitLabel="用当前账号加入"
          fields={[]}
          onSubmit={async () => {
            try {
              await api.rejoin(invitationId);
            } catch (error) {
              return describeError(error, { ...unusable, already_member: '已属于某个家庭' });
            }
            onDone();
          }}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthForm
        title={title}
        description={`${invitation.invitedBy} 邀请`}
        submitLabel="注册并加入"
        fields={[
          { name: 'name', label: '显示名称' },
          { name: 'username', label: '用户名', autoComplete: 'username', hint: '3–30 位字母、数字、下划线或点' },
          { name: 'password', label: '密码', type: 'password', autoComplete: 'new-password', hint: '至少 8 位' },
        ]}
        onSubmit={async (values) => {
          try {
            const { name, username, password } = values;
            await api.join(invitationId, { name: name!, username: username!, password: password! });
          } catch (error) {
            if (error instanceof ApiError && error.code === 'username_taken') return '用户名已被使用';
            if (error instanceof ApiError && error.status === 400) {
              return '填写有误';
            }
            return describeError(error, unusable);
          }
          onDone();
        }}
      />
      {onSignIn && (
        <Button variant="link" className="mt-4 self-center" onClick={onSignIn}>
          已有账号？登录后用它加入
        </Button>
      )}
    </AuthLayout>
  );
}
