// pages/js/crew-login.js — Crew portal login / signup

// If already authenticated, skip to the portal
(async function checkSession() {
  try {
    const res = await fetch("/api/crew/me");
    const data = await res.json();
    if (data.ok) window.location.replace("/crew");
  } catch {}
})();

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".form-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`panel-${tab}`)?.classList.add("active");
    clearAlerts();
  });
});

function clearAlerts() {
  document.querySelectorAll(".alert").forEach(el => { el.className = "alert"; el.textContent = ""; });
}

function showAlert(id, message, type = "error") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.className = `alert ${type}`;
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (loading) {
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> Please wait…`;
    btn.disabled = true;
  } else {
    btn.innerHTML = btn.dataset.origText || btn.innerHTML;
    btn.disabled = false;
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────
document.getElementById("btn-login")?.addEventListener("click", doLogin);
document.getElementById("loginForm")?.addEventListener("submit", e => { e.preventDefault(); doLogin(); });
document.getElementById("login-password")?.addEventListener("keydown", e => {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  clearAlerts();
  const phone    = document.getElementById("login-phone")?.value.trim();
  const password = document.getElementById("login-password")?.value;

  if (!phone || !password) {
    return showAlert("login-alert", "Please enter your phone number and password.");
  }

  setLoading("btn-login", true);
  try {
    const res  = await fetch("/api/crew/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });
    const data = await res.json();
    if (data.ok) {
      window.location.replace("/crew");
    } else {
      showAlert("login-alert", data.error || "Login failed.");
    }
  } catch {
    showAlert("login-alert", "Network error. Please check your connection and try again.");
  }
  setLoading("btn-login", false);
}

// ── Signup ────────────────────────────────────────────────────────────────────
document.getElementById("btn-signup")?.addEventListener("click", doSignup);
document.getElementById("signupForm")?.addEventListener("submit", e => { e.preventDefault(); doSignup(); });
document.getElementById("signup-confirm")?.addEventListener("keydown", e => {
  if (e.key === "Enter") doSignup();
});

async function doSignup() {
  clearAlerts();
  const first_name = document.getElementById("signup-first")?.value.trim();
  const last_name  = document.getElementById("signup-last")?.value.trim();
  const phone      = document.getElementById("signup-phone")?.value.trim();
  const password   = document.getElementById("signup-password")?.value;
  const confirm    = document.getElementById("signup-confirm")?.value;

  if (!first_name || !last_name || !phone || !password || !confirm) {
    return showAlert("signup-alert", "All fields are required.");
  }
  if (password.length < 6) {
    return showAlert("signup-alert", "Password must be at least 6 characters.");
  }
  if (password !== confirm) {
    return showAlert("signup-alert", "Passwords do not match.");
  }

  setLoading("btn-signup", true);
  try {
    const res  = await fetch("/api/crew/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ first_name, last_name, phone, password }),
    });
    const data = await res.json();
    if (data.ok) {
      showAlert("signup-alert", data.message || "Account request submitted! You\u2019ll receive a text when it\u2019s approved.", "success");
      // Clear form
      ["signup-first","signup-last","signup-phone","signup-password","signup-confirm"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
    } else {
      showAlert("signup-alert", data.error || "Signup failed.");
    }
  } catch {
    showAlert("signup-alert", "Network error. Please try again.");
  }
  setLoading("btn-signup", false);
}
