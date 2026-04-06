// api/crew-auth.js — Crew account signup, login, logout, session, and staff management

const crypto = require("crypto");
const {
  ensureStaffSheet, readAllStaff, findStaffByPhone, appendStaffRow, updateStaffRow,
  hashPassword, normalizePhone, setCrewSessionCookie, clearCrewSessionCookie,
  getCrewSession, sendSms, pendingCount,
} = require("../lib/staff");

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
    req.on("error", reject);
  });
}

// POST /api/crew/signup
async function handleSignup(req, res) {
  try {
    const { first_name, last_name, phone, password } = await readBody(req);
    if (!first_name?.trim() || !last_name?.trim() || !phone?.trim() || !password) {
      return json(res, 400, { ok: false, error: "All fields are required." });
    }
    if (password.length < 6) {
      return json(res, 400, { ok: false, error: "Password must be at least 6 characters." });
    }
    const normPhone = normalizePhone(phone);
    const existing = await findStaffByPhone(normPhone);
    if (existing) {
      return json(res, 409, { ok: false, error: "An account with that phone number already exists." });
    }
    const staff = {
      staff_id:      crypto.randomUUID(),
      first_name:    first_name.trim(),
      last_name:     last_name.trim(),
      phone:         normPhone,
      password_hash: hashPassword(password),
      status:        "pending",
      permissions:   "jobs,time,expenses",
      created_at:    new Date().toISOString(),
      approved_at:   "",
      notes:         "",
    };
    await appendStaffRow(staff);

    // Text the owner
    const ownerPhone = process.env.OWNER_PHONE;
    if (ownerPhone) {
      const host = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "";
      await sendSms(ownerPhone,
        `Vickery Electric CRM: New crew account request from ${staff.first_name} ${staff.last_name} (${normPhone}). Approve at ${host}/crm/staff`
      );
    }

    console.log(`[crew-auth] Signup pending: ${staff.first_name} ${staff.last_name} ${normPhone}`);
    json(res, 200, { ok: true, message: "Account request submitted! You\u2019ll receive a text when it\u2019s approved." });
  } catch (err) {
    console.error("[crew-auth/signup]", err.message);
    json(res, 500, { ok: false, error: "Server error. Please try again." });
  }
}

// POST /api/crew/login
async function handleLogin(req, res) {
  try {
    const { phone, password } = await readBody(req);
    if (!phone || !password) {
      return json(res, 400, { ok: false, error: "Phone and password are required." });
    }
    const staff = await findStaffByPhone(normalizePhone(phone));
    if (!staff) {
      return json(res, 401, { ok: false, error: "No account found with that phone number." });
    }
    if (staff.status === "pending") {
      return json(res, 403, { ok: false, error: "Your account is pending approval. You\u2019ll receive a text when it\u2019s ready." });
    }
    if (staff.status === "inactive") {
      return json(res, 403, { ok: false, error: "Your account has been deactivated. Contact your supervisor." });
    }
    if (hashPassword(password) !== staff.password_hash) {
      return json(res, 401, { ok: false, error: "Incorrect password." });
    }
    setCrewSessionCookie(res, staff);
    json(res, 200, {
      ok: true,
      staff: {
        firstName:   staff.first_name,
        lastName:    staff.last_name,
        phone:       staff.phone,
        permissions: (staff.permissions || "").split(",").filter(Boolean),
      },
    });
  } catch (err) {
    console.error("[crew-auth/login]", err.message);
    json(res, 500, { ok: false, error: "Server error. Please try again." });
  }
}

// POST /api/crew/logout
function handleLogout(req, res) {
  clearCrewSessionCookie(res);
  json(res, 200, { ok: true });
}

// GET /api/crew/me
function handleMe(req, res) {
  const session = getCrewSession(req);
  if (!session) return json(res, 401, { ok: false, error: "Not authenticated" });
  json(res, 200, {
    ok: true,
    staff: {
      staffId:     session.staffId,
      firstName:   session.firstName,
      lastName:    session.lastName,
      phone:       session.phone,
      permissions: (session.permissions || "").split(",").filter(Boolean),
    },
  });
}

// GET /api/crew/staff  (CRM owner only — behind requireAuth)
async function handleListStaff(req, res) {
  try {
    const all = await readAllStaff();
    const safe = all.map(({ password_hash, ...s }) => s);
    json(res, 200, { ok: true, staff: safe });
  } catch (err) {
    console.error("[crew-auth/list]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

// GET /api/crew/staff/pending-count  (CRM owner only)
async function handlePendingCount(req, res) {
  try {
    const count = await pendingCount();
    json(res, 200, { ok: true, count });
  } catch (err) {
    json(res, 500, { ok: false, count: 0 });
  }
}

// PATCH /api/crew/staff/:staffId  (CRM owner only — behind requireAuth)
async function handleUpdateStaff(req, res, staffId) {
  try {
    const body = await readBody(req);
    const updates = {};
    ["status", "permissions", "notes"].forEach(k => {
      if (body[k] !== undefined) updates[k] = body[k];
    });
    if (updates.status === "active" && !updates.approved_at) {
      updates.approved_at = new Date().toISOString();
    }

    const ok = await updateStaffRow(staffId, updates);

    // Text the crew member if approving
    if (body.status === "active" && body.phone) {
      await sendSms(body.phone,
        "Vickery Electric: Your crew portal account has been approved! You can now log in at the crew portal."
      );
    }
    if (body.status === "inactive" && body.phone) {
      await sendSms(body.phone,
        "Vickery Electric: Your crew portal account has been deactivated. Contact your supervisor with questions."
      );
    }

    json(res, 200, { ok });
  } catch (err) {
    console.error("[crew-auth/update]", err.message);
    json(res, 500, { ok: false, error: err.message });
  }
}

module.exports = {
  handleSignup, handleLogin, handleLogout, handleMe,
  handleListStaff, handlePendingCount, handleUpdateStaff,
};
