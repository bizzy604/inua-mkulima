/** Typed browser client for session, catalog, wallet, checkout, and receipt APIs. */
export interface Product { id: number; name: string; priceMinor: number; active: boolean; }
export interface Wallet { id: number; name: string; currency: string; balanceMinor: number; formattedBalance: string; farmerName: string; farmerReference: string; farmerPhone: string; }
export interface CartLine { productId: number; quantity: number; expectedUnitPriceMinor: number; deductionMinor: number; }
export interface PreviewLine extends CartLine { productName: string; unitPriceMinor: number; lineTotalMinor: number; }
export interface Preview { items: PreviewLine[]; purchaseTotalMinor: number; deductionTotalMinor: number; customerDueMinor: number; walletBalanceMinor: number; walletAfterMinor: number; }
export interface Transaction extends Preview { id: string; createdAt: string; walletBeforeMinor: number; receiptParties: { farmer: { name: string; reference: string; phone: string }; dealer: { id: string; name: string } } }

/** Sends same-origin requests, unwraps `{data}`, and converts API errors to safe Error objects. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'include', ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const body = await response.json().catch(() => ({})) as { data?: T; error?: { message?: string; code?: string } };
  if (!response.ok) { const error = new Error(body.error?.message ?? 'The request could not be completed.'); error.name = body.error?.code ?? 'REQUEST_ERROR'; throw error; }
  return body.data as T;
}
const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
export const api = {
  me: () => request<{ dealerId: string; username: string; walletId: number }>('/auth/me'),
  login: (username: string, password: string) => request('/auth/login', json({ username, password })),
  logout: () => request('/auth/logout', json({})),
  products: () => request<Product[]>('/products'),
  wallet: () => request<Wallet>('/wallet'),
  preview: (payload: { items: CartLine[]; expectedDeductionTotalMinor: number }) => request<Preview>('/transactions/preview', json(payload)),
  pay: (payload: { items: CartLine[]; expectedDeductionTotalMinor: number; verificationCode: string }, key: string) => request<Transaction>('/transactions', { ...json(payload), headers: { 'Idempotency-Key': key } }),
  receipt: async (id: string) => { const response = await fetch(`/api/transactions/${id}/receipt`, { credentials: 'include' }); if (!response.ok) throw new Error('Receipt download failed.'); return response.blob(); },
};
/** Formats integer KES minor units for display without doing financial arithmetic. */
export const money = (minor: number) => new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(minor / 100);
export const digitsOnly = (value: string) => value.replace(/[^0-9]/g, '');
