// lib/accounting/crm-provider.js
// CRM-native financial provider — reads directly from Google Sheets.
// Replaces the mock provider and removes all QuickBooks dependency.
// All invoice and payment truth lives in the CRM (Invoices + Payments tabs).

const { readTab } = require('../readTab');

const CrmProvider = {
  name: 'crm',

  // createCustomer — CRM is the customer record; nothing to push externally.
  async createCustomer({ name }) {
    return { ok: true, customer_ref: null, display: name || '' };
  },

  // createInvoice — no external system; invoice lives in the Invoices sheet.
  async createInvoice({ invoice_number }) {
    return { ok: true, provider_ref: null, invoice_number };
  },

  // sendInvoice — sending is handled via SMS/email in api/invoices.js; no external push.
  async sendInvoice({ customer_email }) {
    return { ok: true, sent_to: customer_email || null };
  },

  // recordPayment — payment recorded directly in the Payments sheet by api/payments.js.
  async recordPayment() {
    return { ok: true, provider_ref: null };
  },

  // getInvoiceStatus — read from the Invoices sheet.
  async getInvoiceStatus({ invoice_id, provider_ref }) {
    try {
      const invoices = await readTab('Invoices');
      const inv = invoices.find(i =>
        (invoice_id && String(i.id || '') === String(invoice_id)) ||
        (provider_ref && String(i.provider_ref || '') === String(provider_ref))
      );
      return { ok: true, status: inv ? (inv.status_code || 'unknown') : 'not_found' };
    } catch (err) {
      return { ok: false, error: err.message, status: 'unknown' };
    }
  },

  // getCustomerBalance — sum of open invoice balances for client.
  async getCustomerBalance({ client_id }) {
    try {
      const invoices = await readTab('Invoices');
      const open = ['sent', 'deposit_received', 'partial'];
      const balance = invoices
        .filter(i => String(i.client_id || '') === String(client_id || '') && open.includes(String(i.status_code || '').toLowerCase()))
        .reduce((s, i) => s + (Number(i.balance_due) || 0), 0);
      return { ok: true, balance: Math.round(balance * 100) / 100, currency: 'USD' };
    } catch (err) {
      return { ok: false, error: err.message, balance: 0, currency: 'USD' };
    }
  },

  // getARSummary — computed from live Invoices sheet.
  async getARSummary() {
    try {
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
        const due    = inv.due_at    ? new Date(inv.due_at)    : null;

        if (issued && issued >= startOfMonth && sc !== 'void') {
          invoiced_this_month += total;
        }

        const isOpen = ['sent', 'deposit_received', 'partial'].includes(sc);
        if (isOpen && balance > 0) {
          open_ar += balance;
          const ageRef  = due || issued || now;
          const ageDays = Math.max(0, Math.floor((now - ageRef) / 86400000));
          if (ageDays < 30)      aging.current     += balance;
          else if (ageDays < 60) aging.days_30      += balance;
          else if (ageDays < 90) aging.days_60      += balance;
          else                   aging.days_90_plus += balance;
        }
      }

      return {
        ok: true,
        open_ar:              Math.round(open_ar * 100) / 100,
        invoiced_this_month:  Math.round(invoiced_this_month * 100) / 100,
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

  // getCashSnapshot — computed from live Payments sheet.
  async getCashSnapshot() {
    try {
      const payments = await readTab('Payments').catch(() => []);
      const now = new Date();
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const startOfYear  = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

      let collected_this_month = 0;
      let collected_ytd = 0;

      for (const pay of payments) {
        const amount  = Number(pay.net_amount || pay.amount || 0);
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

  // getTransactions / getProfitLoss — CRM-native summaries from Expenses + Payments sheets.
  async getTransactions({ limit = 50 } = {}) {
    try {
      const expenses = await readTab('Expenses').catch(() => []);
      const sorted = expenses
        .filter(e => e.id)
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, limit)
        .map(e => ({
          id:          e.id,
          date:        e.date || e.created_at || '',
          type:        e.type || 'expense',
          vendor:      e.vendor || '',
          amount:      Number(e.amount) || 0,
          description: e.notes || '',
          lead_id:     e.lead_id || '',
          tech_id:     e.tech_id || '',
        }));
      return { ok: true, transactions: sorted };
    } catch (err) {
      return { ok: false, error: err.message, transactions: [] };
    }
  },

  async getProfitLoss({ period = 'month' } = {}) {
    try {
      const [payments, expenses] = await Promise.all([
        readTab('Payments').catch(() => []),
        readTab('Expenses').catch(() => []),
      ]);

      const now = new Date();
      let startDate;
      if (period === 'year')  startDate = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      else                    startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const revenue = payments
        .filter(p => { const d = new Date(p.payment_date || p.created_at || 0); return d >= startDate && !isNaN(d); })
        .reduce((s, p) => s + (Number(p.net_amount || p.amount) || 0), 0);

      const totalExpenses = expenses
        .filter(e => { const d = new Date(e.date || e.created_at || 0); return d >= startDate && !isNaN(d); })
        .reduce((s, e) => s + (Number(e.amount) || 0), 0);

      return {
        ok: true,
        period,
        revenue:        Math.round(revenue * 100) / 100,
        expenses:       Math.round(totalExpenses * 100) / 100,
        net_income:     Math.round((revenue - totalExpenses) * 100) / 100,
      };
    } catch (err) {
      return { ok: false, error: err.message, revenue: 0, expenses: 0, net_income: 0 };
    }
  },
};

module.exports = CrmProvider;
