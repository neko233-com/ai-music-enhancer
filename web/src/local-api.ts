export const LOCAL =
  location.port === '8765' && ['localhost', '127.0.0.1'].includes(location.hostname)
    ? ''
    : 'http://127.0.0.1:8765';
export async function api(path: string, init: RequestInit = {}) {
  let result: Response;
  try {
    result = await fetch(LOCAL + path, {
      ...init,
      headers: { 'X-Neko-Client': '1', ...init.headers },
    });
  } catch {
    throw new Error(
      '无法连接本机 AI 服务。请运行 scripts/start-local.ps1（默认 CPU，无需显卡），并打开 http://127.0.0.1:8765。在线页面需允许浏览器访问本机网络。',
    );
  }
  if (!result.ok) {
    const message = await result.json().catch(() => ({}));
    throw new Error(message.detail || `本地服务错误 (${result.status})`);
  }
  return result;
}
export async function health() {
  return (await api('/api/health', { signal: AbortSignal.timeout(5000) })).json() as Promise<{
    ready: boolean;
    gpu: string;
    processor: string;
    device: string;
    error?: string;
  }>;
}
