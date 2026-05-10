// api/crew-auth.js — Crew account signup, login, logout, session, and staff management

const crypto = require("crypto");
const {
  ensureStaffSheet, readAllStaff, readAllStaffSafe, appendStaffRow, updateStaffRow,
  hashPassword, verifyPassword, needsPasswordRehash, setCrewSessionCookie, clearCrewSessionCookie,
  getCrewSession, sendSms, pendingCount,
} = require("../lib/staff");
const { CREW_TEMPLATES, buildMessage } = require("../lib/sms");
const { setAuthCookie } = require("../lib/auth");
const { getConfig } = require("../lib/config");

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

function ownerSetupCodeMatches(setupCode) {
  const expected = process.env.OWNER_SETUP_CODE;
  if (!expected) return false;

  const submitted = String(setupCode || "");
  const expectedBuffer = Buffer.from(String(expected));
  const submittedBuffer = Buffer.from(submitted);

  return expectedBuffer.length === submittedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, submittedBuffer);
}

// Generate first.last username (lowercase letters only), ensuring uniqueness
async function generateUsername(firstName, lastName) {
  const base = [firstName, lastName]
    .map(s => s.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .join(".");
  const existing = await readAllStaff();
  const taken = new Set(existing.map(s => (s.username || "").toLowerCase()));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

// POST /api/crew/signup
async function handleSignup(req, res) {
  try {
    const { first_name, last_name, password, setup_code } = await readBody(req);
    if (!first_name?.trim() || !last_name?.trim() || !password) {
      return json(res, 400, { ok: false, error: "First name, last name, and password are required." });
    }
    if (password.length < 6) {
      return json(res, 400, { ok: false, error: "Password must be at least 6 characters." });
    }

    // First active account becomes owner only when private setup code is configured and provided.
    const all = await readAllStaff();
    const hasActiveOwner = all.some(s => s.role === "owner" && s.status === "active");
    const isOwner = !hasActiveOwner;
    if (isOwner && process.env.OWNER_SETUP_CODE && !ownerSetupCodeMatches(setup_code)) {
      return json(res, 403, { ok: false, error: "Owner setup code required." });
    }

    const username = await generateUsername(first_name.trim(), last_name.trim());

    // Read owner-configured defaults for new crew accounts
    let defaultPermsStr = "jobs,time,expenses";
    let requireApproval = true;
    if (!isOwner) {
      try {
        const cfg = await getConfig();
        const rawPerms = cfg.default_permissions || "";
        if (rawPerms) {
          const arr = JSON.parse(rawPerms);
          if (Array.isArray(arr) && arr.length > 0) defaultPermsStr = arr.join(",");
        }
        requireApproval = cfg.staff_require_approval !== "false";
      } catch { /* use built-in defaults */ }
    }

    const staff = {
      staff_id:      crypto.randomUUID(),
      first_name:    first_name.trim(),
      last_name:     last_name.trim(),
      phone:         "",
      password_hash: hashPassword(password),
      status:        isOwner ? "active" : (requireApproval ? "pending" : "active"),
      permissions:   isOwner ? "owner" : defaultPermsStr,
      created_at:    new Date().toISOString(),
      approved_at:   isOwner ? new Date().toISOString() : (!isOwner && !requireApproval ? new Date().toISOString() : ""),
      notes:         isOwner ? "Auto-approved as owner (first account)" : "",
      username,
      role:          isOwner ? "owner" : "crew",
    };
    await appendStaffRow(staff);

    if (isOwner) {
      console.log(`[crew-auth] Owner account created: ${staff.first_name} ${staff.last_name} (${username})`);
      return json(res, 200, {
        ok: true,
        message: "Owner account created. You can now sign in.",
        isOwner: true,
      });
    }

    // Notify owner of pending request
    const ownerPhone = process.env.OWNER_PHONE;
    if (ownerPhone) {
      const host = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "";
      await sendSms(ownerPhone,
        `Vickery Electric CRM: New crew account request from ${staff.first_name} ${staff.last_name} (@${username}). Approve at ${host}/crm/staff`
      );
    }

    console.log(`[crew-auth] Signup pending: ${staff.first_name} ${staff.last_name} @${username}`);
    json(res, 200, { ok: true, message: "Account request submitted! You\u2019ll receive a text when it\u2019s approved." });
  } catch (err) {
    console.error("[crew-auth/signup]", err.message);
    json(res, 500, { ok: false, error: "Server error. Please try again." });
  }
}

// POST /api/crew/login  — accepts username + password
async function handleLogin(req, res) {
  try {
    const { username, password } = await readBody(req);
    if (!username || !password) {
      return json(res, 400, { ok: false, error: "Username and password are required." });
    }

    // Read all staff once — detects quota/network degradation vs. truly empty sheet.
    const { rows: allStaff, degraded } = await readAllStaffSafe();

    // ── Degraded sheet: surface a retry message, not a misleading auth error ──
    if (degraded) {
      console.warn("[crew-auth/login] Staff sheet temporarily unavailable; rejecting login");
      return json(res, 503, { ok: false, error: "Service temporarily unavailable. Please try again in a moment." });
    }

    const staff = allStaff.find(s => (s.username || "").toLowerCase() === username.trim().toLowerCase()) || null;

    // ── CRM_PIN emergency bypass (recovery mode only) ─────────────────────────
    // Allowed only when the staff sheet has NO active owner account — i.e. this
    // is a fresh environment or the owner account was wiped. Using CRM_PIN as
    // the password in this state grants a synthetic owner session so the owner
    // can log in and create a proper crew account via the signup flow.
    if (!staff) {
      const pin = process.env.CRM_PIN;
      const hasActiveOwner = allStaff.some(s => s.role === "owner" && s.status === "active");
      let pinMatch = false;
      if (pin && !hasActiveOwner) {
        const pinBuf = Buffer.from(String(pin));
        const pwdBuf = Buffer.from(String(password || ""));
        pinMatch = pinBuf.length === pwdBuf.length && crypto.timingSafeEqual(pinBuf, pwdBuf);
      }
      if (pinMatch) {
        console.log(`[crew-auth/login] CRM_PIN recovery bypass used for username: ${username} (no active owner in sheet)`);
        const syntheticStaff = {
          staff_id:   "owner",
          first_name: username.split(".")[0] || username,
          last_name:  username.split(".")[1] || "",
          username:   username.trim(),
          role:       "owner",
          permissions: "owner",
          status:     "active",
        };
        setCrewSessionCookie(res, syntheticStaff);
        setAuthCookie(res);
        return json(res, 200, {
          ok: true,
          redirect: "/clients",
          role: "owner",
          staff: {
            firstName:   syntheticStaff.first_name,
            lastName:    syntheticStaff.last_name,
            username:    syntheticStaff.username,
            permissions: [],
          },
        });
      }
      return json(res, 401, { ok: false, error: "No account found with that username." });
    }
    if (staff.status === "pending") {
      return json(res, 403, { ok: false, error: "Your account is pending approval. You\u2019ll receive a text when it\u2019s ready." });
    }
    if (staff.status === "inactive") {
      return json(res, 403, { ok: false, error: "Your account has been deactivated. Contact your supervisor." });
    }
    if (!verifyPassword(password, staff.password_hash)) {
      return json(res, 401, { ok: false, error: "Incorrect password." });
    }

    if (needsPasswordRehash(staff.password_hash)) {
      await updateStaffRow(staff.staff_id, { password_hash: hashPassword(password) });
    }

    const isOwner = staff.role === "owner";

    // Set crew session first; then append CRM session for owner (setAuthCookie appends to existing Set-Cookie)
    setCrewSessionCookie(res, staff);
    if (isOwner) {
      setAuthCookie(res);
    }

    json(res, 200, {
      ok: true,
      redirect: isOwner ? "/clients" : "/crew",
      role: staff.role || "crew",
      staff: {
        firstName:   staff.first_name,
        lastName:    staff.last_name,
        username:    staff.username,
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
      username:    session.username || "",
      role:        session.role || "crew",
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
    ["status", "permissions", "notes", "role"].forEach(k => {
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

// POST /api/crew/review-ask  — crew-initiated review request (no client_id needed)
async function handleCrewReviewAsk(req, res) {
  try {
    const session = getCrewSession(req);
    if (!session) return json(res, 401, { ok: false, error: "Not authenticated" });

    const { phone, customer_name, booking_id } = await readBody(req);
    if (!phone) return json(res, 400, { ok: false, error: "Customer phone is required." });

    const techName  = session.firstName || "Your technician";
    const reviewUrl = process.env.GOOGLE_REVIEW_URL || "";
    const body = reviewUrl
      ? `Hi ${customer_name || "there"}, thank you for choosing Vickery Electric! We'd really appreciate a quick Google review: ${reviewUrl} — ${techName} at Vickery Electric`
      : `Hi ${customer_name || "there"}, thank you for choosing Vickery Electric! We'd really appreciate a quick Google review. — ${techName} at Vickery Electric`;

    const sent = await sendSms(phone, body);
    console.log(`[crew/review-ask] booking=${booking_id} phone=${phone} sent=${sent}`);
    json(res, 200, { ok: true, sent });
  } catch (err) {
    console.error("[crew/review-ask]", err.message);
    json(res, 500, { ok: false, error: "Server error." });
  }
}

// POST /api/crew/notify — crew one-tap customer notifications
async function handleCrewNotify(req, res) {
  try {
    const session = getCrewSession(req);
    if (!session) return json(res, 401, { ok: false, error: "Not authenticated" });

    const { action, phone, customer_name, booking_id } = await readBody(req);
    const template = CREW_TEMPLATES[action];
    if (!template)  return json(res, 400, { ok: false, error: "Unknown action." });
    if (!phone)     return json(res, 400, { ok: false, error: "Customer phone is required." });

    const techName = session.firstName || "Your technician";
    const body     = buildMessage(template, { tech_name: techName });
    const sent     = await sendSms(phone, body);
    console.log(`[crew/notify] booking=${booking_id} action=${action} phone=${phone} sent=${sent}`);
    json(res, 200, { ok: true, sent });
  } catch (err) {
    console.error("[crew/notify]", err.message);
    json(res, 500, { ok: false, error: "Server error." });
  }
}

module.exports = {
  handleSignup, handleLogin, handleLogout, handleMe,
  handleListStaff, handlePendingCount, handleUpdateStaff,
  handleCrewReviewAsk, handleCrewNotify,
};
