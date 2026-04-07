// lib/accounting/mock-provider.js
// Simulates accounting operations with a short delay.
// All calls succeed deterministically — no network required.
// Used when ACCOUNTING_PROVIDER=mock (default) or when a real provider is not configured.
// Implements every method in lib/accounting/base.js.

const DELAY_MS = 150;

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function mockRef(prefix) {
  return prefix + '-MOCK-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

const MockProvider = {
  name: 'mock',

  async createCustomer({ name }) {
    await delay(DELAY_MS);
    return { ok: true, customer_ref: mockRef('CUST'), display: name || 'Mock Customer' };
  },

  async createInvoice({ invoice_number, invoice_id, customer_name, total }) {
    await delay(DELAY_MS);
    const provider_ref = mockRef('INV');
    return {
      ok: true,
      provider_ref,
      invoice_url: `https://mock.vickeryelectric.com/inv/${provider_ref}`,
      invoice_number,
    };
  },

  async sendInvoice({ provider_ref, invoice_number, customer_name, customer_email }) {
    await delay(DELAY_MS);
    return { ok: true, sent_to: customer_email || null };
  },

  async recordPayment({ invoice_ref, amount, method, date, note }) {
    await delay(DELAY_MS);
    return { ok: true, provider_ref: mockRef('PAY') };
  },

  async getInvoiceStatus({ provider_ref }) {
    await delay(DELAY_MS);
    return { ok: true, status: 'sent' };
  },

  async getCustomerBalance({ customer_ref }) {
    await delay(DELAY_MS);
    return { ok: true, balance: 0, currency: 'USD' };
  },
};

module.exports = MockProvider;
