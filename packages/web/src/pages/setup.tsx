import { AuthForm, AuthLayout } from '@/components/auth-form';
import { api, ApiError } from '@/lib/api';

export function SetupPage({ onDone }: { onDone(): void }) {
  return (
    <AuthLayout>
      <AuthForm
        title="欢迎使用 StockUp"
        description="创建第一个账号。你将成为这个实例和第一个家庭的管理员。"
        submitLabel="创建并进入"
        fields={[
          { name: 'householdName', label: '家庭名称' },
          { name: 'name', label: '显示名称', hint: '家人在价格记录上看到的名字' },
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
            if (error instanceof ApiError && error.status === 409) return '这个实例已经设置过了，请直接登录。';
            if (error instanceof ApiError && error.status === 400) return '请检查填写的内容：名称不超过 50 字，用户名和密码符合提示的格式。';
            throw error;
          }
          onDone();
        }}
      />
    </AuthLayout>
  );
}
