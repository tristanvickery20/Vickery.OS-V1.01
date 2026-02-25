const https = require("https");
const http = require("http");
const { URL } = require("url");

function postToAppsScript(payload) {
  return new Promise((resolve, reject) => {
    const url = process.env.APPS_SCRIPT_URL;
    if (!url) return reject(new Error("APPS_SCRIPT_URL is not set"));

    const body = JSON.stringify(payload);
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = transport.request(options, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        const redirectUrl = res.headers.location;
        if (!redirectUrl) return reject(new Error("Redirect with no Location header"));
        return postToAppsScript.redirect(redirectUrl, body).then(resolve).catch(reject);
      }

      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Apps Script returned ${res.statusCode}: ${data}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Invalid JSON from Apps Script: " + data.slice(0, 300)));
        }
      });
    });

    req.on("error", (err) => reject(new Error("Apps Script request failed: " + err.message)));
    req.write(body);
    req.end();
  });
}

postToAppsScript.redirect = function (url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Apps Script redirect returned ${res.statusCode}: ${data}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error("Invalid JSON from Apps Script redirect: " + data.slice(0, 300)));
        }
      });
    });

    req.on("error", (err) => reject(new Error("Apps Script redirect failed: " + err.message)));
    req.write(body);
    req.end();
  });
};

module.exports = { postToAppsScript };
