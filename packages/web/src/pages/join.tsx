import { useEffect, useState } from 'react';
import { AuthForm, AuthLayout } from '@/components/auth-form';
import { Button } from '@/components/ui/button';
import { describeError } from '@/components/editing';
import { api, ApiError } from '@/lib/api';

const unusable: Record<string, string> = {
  not_found: '这个邀请链接不存在，请检查链接是否完整。',
  invitation_used: '这个邀请链接已经被使用过了，请向家庭管理员要一个新的。',
  invitation_revoked: '这个邀请链接已被作废，请向家庭管理员要一个新的。',
  invitation_expired: '这个邀请链接已经过期，请向家庭管理员要一个新的。',
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

  if (invitation.state === 'loading') return null;
  if (invitation.state === 'error') {
    return (
      <AuthLayout>
        <p role="alert" className="text-center">
          {invitation.message}
        </p>
      </AuthLayout>
    );
  }

  const title = `加入「${invitation.householdName}」`;
  if (signedIn) {
    return (
      <AuthLayout>
        <AuthForm
          title={title}
          description={`${invitation.invitedBy} 邀请你加入。你会用当前账号加入，以前录入的价格记录仍然显示你的名字。`}
          submitLabel="用当前账号加入"
          fields={[]}
          onSubmit={async () => {
            try {
              await api.rejoin(invitationId);
            } catch (error) {
              return describeError(error, { ...unusable, already_member: '你已经是某个家庭的成员了。' });
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
        description={`${invitation.invitedBy} 邀请你加入。注册后就能和家人一起记录和查看价格。`}
        submitLabel="注册并加入"
        fields={[
          { name: 'name', label: '显示名称', hint: '家人在价格记录上看到的名字' },
          { name: 'username', label: '用户名', autoComplete: 'username', hint: '3–30 位字母、数字、下划线或点' },
          { name: 'password', label: '密码', type: 'password', autoComplete: 'new-password', hint: '至少 8 位' },
        ]}
        onSubmit={async (values) => {
          try {
            const { name, username, password } = values;
            await api.join(invitationId, { name: name!, username: username!, password: password! });
          } catch (error) {
            if (error instanceof ApiError && error.code === 'username_taken') return '这个用户名已经被使用，请换一个。';
            if (error instanceof ApiError && error.status === 400) {
              return '请检查填写的内容：名称不超过 50 字，用户名和密码符合提示的格式。';
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
