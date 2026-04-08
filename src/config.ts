interface QuipuConfig {
  serverUrl?: string;
  wsUrl?: string;
}

declare global {
  interface Window {
    __QUIPU_CONFIG__?: QuipuConfig;
  }
}

const config = window.__QUIPU_CONFIG__;
export const SERVER_URL: string = config?.serverUrl || 'http://localhost:4848';
export const WS_URL: string = config?.wsUrl || SERVER_URL.replace(/^http/, 'ws');
