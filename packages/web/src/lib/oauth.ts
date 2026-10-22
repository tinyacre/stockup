export const scopeDescriptions: Record<string, string> = {
  'stockup:read': '查看家庭的商品和价格',
  'stockup:write': '以你的名义新建、修改和删除商品、渠道、分类和价格记录',
  openid: '确认你的身份',
  profile: '读取你的显示名称和用户名',
  offline_access: '保持连接，不必每次重新授权',
};

// The client ID of an MCP client is the URL of its metadata document, so its host is what the member can
// trust. The name comes from that document, so any client can claim to be Claude.
export function clientHost(clientId: string) {
  return URL.canParse(clientId) ? new URL(clientId).host : clientId;
}
