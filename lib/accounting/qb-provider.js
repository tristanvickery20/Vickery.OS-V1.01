// lib/accounting/qb-provider.js
// Full QuickBooks Online accounting provider.
// Implements all methods defined in lib/accounting/base.js.
// Tokens are stored encrypted in the Config sheet and auto-refreshed on expiry.
// Set ACCOUNTING_PROVIDER=qb_sandbox or qb_live in env to activate.

const { getConfig, setConfigKeys } = require("../config");
const {
  encryptSecret,
  decryptSecret,
  refreshAccessToken,
  expiresAt,
} = require("./qb-oauth");

// ─── Internal QB HTTP request with auto-refresh ───────────────────────────────

async function _qbFetch(path, opts = {}) {
  const cfg = await getConfig();
  const env = cfg.qb_environment === "production" ? "production" : "sandbox";
  const base = env === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
  const realmId = cfg.qb_realm_id;
  if (!realmId) throw new Error("QB Realm ID not configured.");

  let accessToken = decryptSecret(cfg.qb_access_token || "");

  // Auto-refresh if token expires within 5 minutes
  const expiresIso = cfg.qb_token_expires_at || "";
  const needsRefresh = expiresIso && new Date(expiresIso) < new Date(Date.now() + 5 * 60 * 1000);
  if (needsRefresh) {
    const clientId     = cfg.qb_client_id || "";
    const clientSecret = decryptSecret(cfg.qb_client_secret || "");
    const refreshToken = decryptSecret(cfg.qb_refresh_token || "");
    if (clientId && clientSecret && refreshToken) {
      try {
        const newTokens = await refreshAccessToken(clientId, clientSecret, refreshToken);
        accessToken = newTokens.access_token;
        await setConfigKeys({
          qb_access_token:         encryptSecret(newTokens.access_token),
          qb_refresh_token:        encryptSecret(newTokens.refresh_token),
          qb_token_expires_at:     expiresAt(newTokens.expires_in),
          qb_refresh_expires_at:   expiresAt(newTokens.x_refresh_token_expires_in),
          qb_connected:            "true",
        });
        console.log("[QB] Access token auto-refreshed.");
      } catch (refreshErr) {
        console.warn("[QB] Token refresh failed:", refreshErr.message);
      }
    }
  }

  const url = `${base}/v3/company/${realmId}${path}`;
  const headers = {
    "Authorization": `Bearer ${accessToken}`,
    "Accept":        "application/json",
    "Content-Type":  "application/json",
    ...(opts.headers || {}),
  };

  const r = await fetch(url, { ...opts, headers });

  // If 401 even after attempted refresh, mark disconnected for UI feedback
  if (r.status === 401) {
    await setConfigKeys({ qb_connected: "false" }).catch(() => {});
    throw new Error("QB OAuth token expired or revoked. Reconnect in Settings → Billing.");
  }

  return r;
}

// ─── QB query helper ─────────────────────────────────────────────────────────

async function _query(sql) {
  const encoded = encodeURIComponent(sql);
  const r = await _qbFetch(`/query?query=${encoded}&minorversion=65`);
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`QB query failed (HTTP ${r.status}): ${text.slice(0, 300)}`);
  }
  const data = await r.json();
  return data?.QueryResponse || {};
}

// ─── QB POST helper ──────────────────────────────────────────────────────────

async function _post(endpoint, payload) {
  const r = await _qbFetch(`${endpoint}?minorversion=65`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`QB POST ${endpoint} failed (HTTP ${r.status}): ${text.slice(0, 300)}`);
  }
  return r.json();
}

// ─── Provider implementation ─────────────────────────────────────────────────

const QbProvider = {
  name: "quickbooks",

  // ── Customer ──────────────────────────────────────────────────────────────

  async createCustomer({ name, phone, email }) {
    try {
      const payload = {
        DisplayName: name,
        ...(phone ? { PrimaryPhone: { FreeFormNumber: phone } } : {}),
        ...(email ? { PrimaryEmailAddr: { Address: email } } : {}),
      };
      const data = await _post("/customer", payload);
      const cust = data?.Customer;
      return { ok: true, customer_ref: String(cust?.Id || ""), display: cust?.DisplayName || name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // ── Invoice ───────────────────────────────────────────────────────────────

  async createInvoice({ invoice_number, customer_name, total, subtotal, tax_amount, line_items, customer_ref }) {
    try {
      const cfg = await getConfig();
      // Try to find the QB Customer ID if not provided
      let custId = customer_ref || "";
      if (!custId && customer_name) {
        try {
          const qr = await _query(`SELECT Id FROM Customer WHERE DisplayName = '${customer_name.replace(/'/g, "\\'")}'`);
          custId = qr?.Customer?.[0]?.Id || "";
        } catch {}
      }

      const lines = Array.isArray(line_items) && line_items.length > 0
        ? line_items.map((li, idx) => ({
            LineNum: idx + 1,
            Amount: Number(li.total || li.price || 0),
            DetailType: "SalesItemLineDetail",
            SalesItemLineDetail: {
              ItemRef: { value: "1", name: "Services" },
              Qty:    Number(li.qty || 1),
              UnitPrice: Number(li.price || 0),
            },
            Description: li.description || li.desc || "",
          }))
        : [{
            Amount: Number(subtotal || total || 0),
            DetailType: "SalesItemLineDetail",
            SalesItemLineDetail: { ItemRef: { value: "1", name: "Services" } },
          }];

      const payload = {
        DocNumber:   String(invoice_number || ""),
        CustomerRef: custId ? { value: custId } : undefined,
        Line: lines,
        ...(tax_amount ? {
          TxnTaxDetail: {
            TotalTax: Number(tax_amount),
            TaxLine: [{
              Amount: Number(tax_amount),
              DetailType: "TaxLineDetail",
              TaxLineDetail: { TaxRateRef: { value: "1" }, PercentBased: false },
            }],
          },
        } : {}),
      };

      const data = await _post("/invoice", payload);
      const inv = data?.Invoice;
      const realmId = cfg.qb_realm_id;
      const env = cfg.qb_environment === "production" ? "" : "sandbox.";
      const invoice_url = inv?.Id
        ? `https://${env}qbo.intuit.com/app/invoice?txnId=${inv.Id}`
        : "";
      return { ok: true, provider_ref: String(inv?.Id || ""), invoice_url, invoice_number };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // ── Send Invoice ─────────────────────────────────────────────────────────

  async sendInvoice({ provider_ref, customer_email }) {
    try {
      if (!provider_ref) return { ok: false, error: "No QB invoice ID to send." };
      const email = customer_email || "";
      const r = await _qbFetch(`/invoice/${provider_ref}/send${email ? `?sendTo=${encodeURIComponent(email)}` : ""}?minorversion=65`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: "",
      });
      if (!r.ok) {
        const t = await r.text();
        return { ok: false, error: `QB send failed (HTTP ${r.status})` };
      }
      return { ok: true, sent_to: email || null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // ── Record Payment ────────────────────────────────────────────────────────

  async recordPayment({ invoice_ref, amount, method, date, note }) {
    try {
      const cfg = await getConfig();
      const depositAccountId = cfg.qb_bank_account_id || "1";

      const methodMap = {
        cash:   "Cash",
        check:  "Check",
        card:   "CreditCard",
        credit: "CreditCard",
      };
      const payMethod = methodMap[(method || "").toLowerCase()] || "Cash";

      const payload = {
        TotalAmt:         Number(amount || 0),
        CustomerRef:      { value: "1" }, // fallback; real usage passes customer_ref
        DepositToAccountRef: { value: depositAccountId },
        PaymentMethodRef: { name: payMethod },
        TxnDate:          date || new Date().toISOString().slice(0, 10),
        PrivateNote:      note || "",
        ...(invoice_ref ? {
          Line: [{
            Amount: Number(amount || 0),
            LinkedTxn: [{ TxnId: String(invoice_ref), TxnType: "Invoice" }],
          }],
        } : {}),
      };

      const data = await _post("/payment", payload);
      const pay = data?.Payment;
      return { ok: true, provider_ref: String(pay?.Id || "") };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // ── Invoice Status ────────────────────────────────────────────────────────

  async getInvoiceStatus({ provider_ref }) {
    try {
      if (!provider_ref) return { ok: false, error: "No provider_ref." };
      const r = await _qbFetch(`/invoice/${provider_ref}?minorversion=65`);
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const data = await r.json();
      const inv = data?.Invoice;
      // Map QB balance to CRM status
      const balance = Number(inv?.Balance || 0);
      const total   = Number(inv?.TotalAmt || 0);
      let status = "sent";
      if (balance === 0 && total > 0)              status = "paid";
      else if (balance > 0 && balance < total)     status = "partial";
      else if (inv?.EmailStatus === "NotSet")      status = "draft";
      return { ok: true, status };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // ── Customer Balance ─────────────────────────────────────────────────────

  async getCustomerBalance({ customer_ref }) {
    try {
      if (!customer_ref) return { ok: true, balance: 0, currency: "USD" };
      const r = await _qbFetch(`/customer/${customer_ref}?minorversion=65`);
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      const data = await r.json();
      const balance = Number(data?.Customer?.Balance || 0);
      return { ok: true, balance, currency: "USD" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  // ── AR Summary ────────────────────────────────────────────────────────────
  // Pulls real invoice data from QB and computes aging buckets.

  async getARSummary() {
    try {
      const now   = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      // All open invoices (unpaid balance > 0)
      const openQr = await _query("SELECT Id, Balance, TotalAmt, DueDate, TxnDate FROM Invoice WHERE Balance > '0' MAXRESULTS 200");
      const openInvoices = openQr?.Invoice || [];

      // Invoices created this month (for invoiced_this_month)
      const monthQr = await _query(`SELECT Id, TotalAmt FROM Invoice WHERE TxnDate >= '${month}' MAXRESULTS 200`);
      const monthInvoices = monthQr?.Invoice || [];

      let open_ar = 0;
      const aging = { current: 0, days_30: 0, days_60: 0, days_90_plus: 0 };

      for (const inv of openInvoices) {
        const balance = Number(inv.Balance || 0);
        open_ar += balance;
        const due = inv.DueDate ? new Date(inv.DueDate) : (inv.TxnDate ? new Date(inv.TxnDate) : now);
        const ageDays = Math.max(0, Math.floor((now - due) / (1000 * 60 * 60 * 24)));
        if (ageDays < 30)      aging.current     += balance;
        else if (ageDays < 60) aging.days_30      += balance;
        else if (ageDays < 90) aging.days_60      += balance;
        else                   aging.days_90_plus += balance;
      }

      const invoiced_this_month = monthInvoices.reduce((s, i) => s + Number(i.TotalAmt || 0), 0);

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

  // ── Cash Snapshot ─────────────────────────────────────────────────────────
  // Pulls real payment data from QB.

  async getCashSnapshot() {
    try {
      const now  = new Date();
      const year = `${now.getFullYear()}-01-01`;
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

      const ytdQr = await _query(`SELECT Id, TotalAmt, TxnDate FROM Payment WHERE TxnDate >= '${year}' MAXRESULTS 500`);
      const ytdPayments = ytdQr?.Payment || [];

      let collected_ytd        = 0;
      let collected_this_month = 0;
      const monthStart = new Date(month);

      for (const pay of ytdPayments) {
        const amt = Number(pay.TotalAmt || 0);
        collected_ytd += amt;
        if (pay.TxnDate && new Date(pay.TxnDate) >= monthStart) {
          collected_this_month += amt;
        }
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

  // ── Expense Accounts (Chart of Accounts — expense types only) ────────────
  // Used to populate the Category dropdown in the CRM expense form.

  async getAccounts() {
    try {
      const qr = await _query(
        "SELECT Id, Name, AccountType, Active FROM Account WHERE Active = true MAXRESULTS 200"
      );
      const expenseTypes = new Set(["Expense", "Cost of Goods Sold", "Other Expense"]);
      const accounts = (qr?.Account || [])
        .filter((a) => expenseTypes.has(a.AccountType))
        .map((a) => ({ id: a.Id, name: a.Name, type: a.AccountType }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, accounts };
    } catch (err) {
      return { ok: false, error: err.message, accounts: [] };
    }
  },

  // ── Transactions (Purchases/Expenses) ─────────────────────────────────────
  // Returns card swipes, check payments, material purchases — all QB Purchase records.
  // Includes EntityRef (Payee) and parses category from PrivateNote when available.

  async getTransactions({ startDate, endDate, maxResults } = {}) {
    try {
      const now = new Date();
      const defaultStart = `${now.getFullYear()}-01-01`;
      const start = startDate || defaultStart;
      const end   = endDate   || now.toISOString().slice(0, 10);
      const max   = maxResults || 100;

      const qr = await _query(
        `SELECT Id, TxnDate, TotalAmt, PaymentType, PrivateNote, AccountRef, EntityRef FROM Purchase WHERE TxnDate >= '${start}' AND TxnDate <= '${end}' ORDERBY TxnDate DESC MAXRESULTS ${max}`
      );

      const purchases = (qr?.Purchase || []).map((p) => {
        // Parse category from CRM-pushed PrivateNote: "CRM Expense EXP-xxx — Category: Foo — Payee — notes"
        const note = p.PrivateNote || "";
        let category = "";
        const catMatch = note.match(/Category:\s*([^—\n]+)/);
        if (catMatch) category = catMatch[1].trim();

        return {
          id:           p.Id,
          date:         p.TxnDate,
          amount:       Number(p.TotalAmt || 0),
          payment_type: p.PaymentType || "",
          note:         note.replace(/^CRM Expense [^\s]+ — /, "").replace(/Category:[^—]+— ?/, "").trim(),
          account:      p.AccountRef?.name || "",
          payee:        p.EntityRef?.name || "",
          category,
          type:         "purchase",
        };
      });

      return { ok: true, transactions: purchases };
    } catch (err) {
      return { ok: false, error: err.message, transactions: [] };
    }
  },

  // ── Profit & Loss Summary ─────────────────────────────────────────────────

  async getProfitLoss({ startDate, endDate } = {}) {
    try {
      const now  = new Date();
      const year = now.getFullYear();
      const start = startDate || `${year}-01-01`;
      const end   = endDate   || now.toISOString().slice(0, 10);

      const r = await _qbFetch(
        `/reports/ProfitAndLoss?start_date=${start}&end_date=${end}&minorversion=65`
      );
      if (!r.ok) {
        const t = await r.text();
        return { ok: false, error: `QB P&L report failed (HTTP ${r.status})` };
      }
      const data = await r.json();

      // Extract top-level Income and Expense totals from the report rows
      let income   = 0;
      let expenses = 0;
      const rows = data?.Rows?.Row || [];
      for (const section of rows) {
        const header = section?.Header?.ColData?.[0]?.value || "";
        const summary = section?.Summary?.ColData;
        if (!summary) continue;
        const val = Number(summary[1]?.value || summary[0]?.value || 0);
        if (/income|revenue/i.test(header))   income   = val;
        if (/expense|cost/i.test(header))     expenses = val;
      }

      return {
        ok:       true,
        income:   Math.round(income * 100) / 100,
        expenses: Math.round(expenses * 100) / 100,
        net:      Math.round((income - expenses) * 100) / 100,
        start_date: start,
        end_date:   end,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};

module.exports = QbProvider;
