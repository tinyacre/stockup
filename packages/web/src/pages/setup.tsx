import { AuthForm, AuthLayout } from '@/components/auth-form';
import { api, ApiError } from '@/lib/api';

export function SetupPage({ onDone }: { onDone(): void }) {
  return (
    <AuthLayout>
      <AuthForm
        title="初始设置"
        submitLabel="创建并进入"
        fields={[
          { name: 'householdName', label: '家庭名称' },
          { name: 'name', label: '显示名称' },
          { name: 'username', label: '用户名', autoComplete: 'username', hint: '3–30 位字母、数字、下划线或点' },
          { name: 'password', label: '密码', type: 'password', autoComplete: 'new-password', hint: '至少 8 位' },
        ]}
        onSubmit={async (values) => {
          try {
            await api.setUp({
              householdName: values.householdName!,
              name: values.name!,
              username: values.username!,
              password: values.password!,
            });
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) return '已完成初始设置';
            if (error instanceof ApiError && error.status === 400) return '填写有误';
            throw error;
          }
          onDone();
        }}
      />
    </AuthLayout>
  );
}
