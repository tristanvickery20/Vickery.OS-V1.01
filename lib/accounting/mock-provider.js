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

  // Returns AR summary computed from the live Invoices sheet.
  // When a real provider (QuickBooks) is connected, this would call their API.
  async getARSummary() {
    await delay(DELAY_MS);
    try {
      const { readTab } = require('../readTab');
      const invoices = await readTab('Invoices').catch(() => []);

      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      let open_ar = 0;
      let invoiced_this_month = 0;
      const aging = { current: 0, days_30: 0, days_60: 0, days_90_plus: 0 };

      for (const inv of invoices) {
        const sc = String(inv.status_code || '').toLowerCase();
        const total = Number(inv.total || 0);
        const balance = Number(inv.balance_due || 0);
        const issued = inv.issued_at ? new Date(inv.issued_at) : null;
        const due = inv.due_at ? new Date(inv.due_at) : null;

        // Invoiced this month (all non-void invoices issued this month)
        if (issued && issued >= startOfMonth && sc !== 'void') {
          invoiced_this_month += total;
        }

        // Open AR: unpaid balances (sent, deposit_received, partial)
        const isOpen = ['sent', 'deposit_received', 'partial'].includes(sc);
        if (isOpen && balance > 0) {
          open_ar += balance;

          // Aging: days past due date (or days since issued if no due date)
          const ageRef = due || issued || now;
          const ageDays = Math.max(0, Math.floor((now - ageRef) / (1000 * 60 * 60 * 24)));

          if (ageDays < 30)      aging.current    += balance;
          else if (ageDays < 60) aging.days_30    += balance;
          else if (ageDays < 90) aging.days_60    += balance;
          else                   aging.days_90_plus += balance;
        }
      }

      return {
        ok: true,
        open_ar: Math.round(open_ar * 100) / 100,
        invoiced_this_month: Math.round(invoiced_this_month * 100) / 100,
        aging: {
          current:      Math.round(aging.current * 100) / 100,
          days_30:      Math.round(aging.days_30 * 100) / 100,
          days_60:      Math.round(aging.days_60 * 100) / 100,
          days_90_plus: Math.round(aging.days_90_plus * 100) / 100,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message, open_ar: 0, invoiced_this_month: 0, aging: { current: 0, days_30: 0, days_60: 0, days_90_plus: 0 } };
    }
  },

  // Returns cash collected computed from the live Payments sheet.
  async getCashSnapshot() {
    await delay(DELAY_MS);
    try {
      const { readTab } = require('../readTab');
      const payments = await readTab('Payments').catch(() => []);

      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const startOfYear  = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

      let collected_this_month = 0;
      let collected_ytd = 0;

      for (const pay of payments) {
        const amount = Number(pay.amount || 0);
        const dateStr = pay.payment_date || pay.created_at || '';
        const d = dateStr ? new Date(dateStr) : null;
        if (!d || isNaN(d)) continue;

        if (d >= startOfYear)  collected_ytd        += amount;
        if (d >= startOfMonth) collected_this_month  += amount;
      }

      return {
        ok: true,
        collected_this_month: Math.round(collected_this_month * 100) / 100,
        collected_ytd:        Math.round(collected_ytd * 100) / 100,
      };
    } catch (err) {
      return { ok: false, error: err.message, collected_this_month: 0, collected_ytd: 0 };
    }
  },
};

module.exports = MockProvider;
