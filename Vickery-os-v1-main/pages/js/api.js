async function fetchText(url, options) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  if (!resp.ok) throw new Error(text);
  return text;
}

async function fetchJson(url, options) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

window.Api = { fetchText, fetchJson };