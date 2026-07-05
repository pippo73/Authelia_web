"use strict";

// State: the "base" YAML is the source of truth for comments/unmanaged sections.
// Forms edit the base fields; "Generate" merges the forms into the base, keeping the rest.
const state = {
  activeFile: "config", // "config" | "users"
  advanced: false,
  config: { raw: "", basic: null },
  users: { raw: "", users: [] },
  output: { config: "", users: "" },
};

const FILE_NAMES = { config: "configuration.yml", users: "users_database.yml" };

const t = (key, params) => I18n.t(key, params);
// Small "?" help icon with a hover balloon, for dynamically-built field labels.
const help = (key) => `<span class="help" data-tip="${esc(t(key))}">?</span>`;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch (_) {}
    throw new Error(msg);
  }
  return res.json();
}

function setStatus(id, msg, kind) {
  const e = $(id);
  e.textContent = msg;
  e.className = "status" + (kind ? " " + kind : "");
}

// ------------------------------------------------------------------ Tab switch
function setActiveFile(file) {
  state.activeFile = file;
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.file === file)
  );
  $("section-config").classList.toggle("hidden", file !== "config");
  $("section-users").classList.toggle("hidden", file !== "users");
  $("advancedFileLabel").textContent = FILE_NAMES[file];
  refreshRaw();
  refreshOutput();
  setStatus("loadStatus", "", "");
  setStatus("genStatus", "", "");
}

// ------------------------------------------------------------------ Advanced
function setAdvanced(on) {
  state.advanced = on;
  document.body.classList.toggle("advanced", on);
  if (on) refreshRaw();
}

function refreshRaw() {
  $("rawYaml").value = state[state.activeFile].raw || "";
}

function refreshOutput() {
  const out = state.output[state.activeFile];
  $("outputPanel").classList.toggle("hidden", !out);
  $("outputYaml").textContent = out || "";
  $("outputFileLabel").textContent = out ? FILE_NAMES[state.activeFile] : "";
  const has = !!out;
  $("downloadBtn").disabled = !has;
  $("copyBtn").disabled = !has;
}

// ------------------------------------------------------------------ Load file
async function loadText(text) {
  const file = state.activeFile;
  state[file].raw = text;
  try {
    if (file === "config") {
      const { basic } = await api("/api/config/parse", { yaml: text });
      state.config.basic = basic;
      renderConfigForms();
    } else {
      const { users } = await api("/api/users/parse", { yaml: text });
      state.users.users = users;
      renderUsers();
    }
    refreshRaw();
    setStatus("loadStatus", t("status.loaded"), "ok");
  } catch (e) {
    setStatus("loadStatus", t("status.error", { msg: e.message }), "err");
  }
}

// ------------------------------------------------------------------ Config forms
function fillInput(id, value) { $(id).value = value == null ? "" : value; }

function renderConfigForms() {
  const b = state.config.basic || {};
  fillInput("cfg_theme", b.theme);
  fillInput("cfg_log_level", b.log_level);
  fillInput("cfg_server_address", b.server_address);
  fillInput("cfg_session_name", b.session_name);
  fillInput("cfg_session_domain", b.session_domain);
  fillInput("cfg_session_authelia_url", b.session_authelia_url);
  fillInput("cfg_session_expiration", b.session_expiration);
  fillInput("cfg_session_inactivity", b.session_inactivity);
  fillInput("cfg_session_remember_me", b.session_remember_me);
  fillInput("cfg_default_policy", b.default_policy);
  renderRules(b.rules || []);
  // identity_providers.oidc
  fillInput("cfg_oidc_hmac_secret", b.oidc_hmac_secret);
  fillInput("cfg_oidc_enforce_pkce", b.oidc_enforce_pkce);
  fillInput("cfg_oidc_ls_access", b.oidc_ls_access);
  fillInput("cfg_oidc_ls_id", b.oidc_ls_id);
  fillInput("cfg_oidc_ls_refresh", b.oidc_ls_refresh);
  fillInput("cfg_oidc_ls_code", b.oidc_ls_code);
  $("cfg_oidc_debug").checked = !!b.oidc_debug;
  renderClients(b.oidc_clients || []);
}

function renderRules(rules) {
  const list = $("rulesList");
  list.innerHTML = "";
  rules.forEach((r, i) => list.appendChild(ruleRow(r, i)));
}

function ruleRow(rule, index) {
  const box = el("div", "rule");
  const head = el("div", "rule-head");
  head.appendChild(el("span", "num", t("rule.label", { n: index + 1 })));
  const del = el("button", "btn-del", t("common.delete"));
  del.onclick = () => box.remove();
  head.appendChild(del);
  box.appendChild(head);

  const grid = el("div", "grid");
  const join = (a) => (Array.isArray(a) ? a.join(", ") : a || "");
  grid.innerHTML = `
    <label>${esc(t("rule.domains"))}${help("help.rule.domains")}
      <input class="r-domain" value="${esc(join(rule.domain))}" placeholder="app.example.com" /></label>
    <label>${esc(t("rule.policy"))}${help("help.rule.policy")}
      <select class="r-policy">
        ${["", "deny", "bypass", "one_factor", "two_factor"].map(
          (p) => `<option value="${p}" ${p === (rule.policy || "") ? "selected" : ""}>${p || esc(t("opt.none"))}</option>`
        ).join("")}
      </select></label>
    <label>${esc(t("rule.subject"))}${help("help.rule.subject")}
      <input class="r-subject" value="${esc(join(rule.subject))}" placeholder="group:admins" /></label>
    <label>${esc(t("rule.resources"))}${help("help.rule.resources")}
      <input class="r-resources" value="${esc(join(rule.resources))}" placeholder="^/api/.*$" /></label>
    <label>${esc(t("rule.networks"))}${help("help.rule.networks")}
      <input class="r-networks" value="${esc(join(rule.networks))}" placeholder="192.168.1.0/24" /></label>
  `;
  box.appendChild(grid);
  return box;
}

function collectRules() {
  const split = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
  return [...document.querySelectorAll("#rulesList .rule")].map((box) => ({
    domain: split(box.querySelector(".r-domain").value),
    policy: box.querySelector(".r-policy").value,
    subject: split(box.querySelector(".r-subject").value),
    resources: split(box.querySelector(".r-resources").value),
    networks: split(box.querySelector(".r-networks").value),
  }));
}

// ------------------------------------------------------------------ OIDC clients
function renderClients(list) {
  const clients = list || (state.config.basic && state.config.basic.oidc_clients) || [];
  const container = $("clientsList");
  container.innerHTML = "";
  clients.forEach((c, i) => container.appendChild(clientRow(c, i)));
}

function clientRow(client, index) {
  const box = el("div", "rule");
  const head = el("div", "rule-head");
  head.appendChild(el("span", "num", t("client.label", { n: index + 1 })));
  const del = el("button", "btn-del", t("common.delete"));
  del.onclick = () => box.remove();
  head.appendChild(del);
  box.appendChild(head);

  const grid = el("div", "grid");
  const join = (a) => (Array.isArray(a) ? a.join(", ") : a || "");
  const opts = (list, current) => {
    // keep a custom/current value (e.g. a named authorization_policy) so it is not lost
    const values = current && !list.includes(current) ? [current, ...list] : list;
    return values
      .map((p) => `<option value="${esc(p)}" ${p === (current || "") ? "selected" : ""}>${p ? esc(p) : esc(t("opt.unset"))}</option>`)
      .join("");
  };
  grid.innerHTML = `
    <label>${esc(t("client.id"))}${help("help.client.id")}
      <input class="c-id" value="${esc(client.client_id)}" placeholder="my-app" /></label>
    <label>${esc(t("client.name"))}${help("help.client.name")}
      <input class="c-name" value="${esc(client.client_name)}" placeholder="My App" /></label>
    <label>${esc(t("client.secret"))}${help("help.client.secret")}
      <span class="input-with-btn">
        <input class="c-secret" value="${esc(client.client_secret)}" placeholder="plaintext → Hash, or paste a hash" />
        <button type="button" class="ghost btn-hash">${esc(t("client.hash"))}</button>
      </span></label>
    <label>${esc(t("client.authPolicy"))}${help("help.client.authPolicy")}
      <select class="c-policy">${opts(["", "one_factor", "two_factor"], client.authorization_policy)}</select></label>
    <label>${esc(t("client.redirectUris"))}${help("help.client.redirectUris")}
      <input class="c-redirect" value="${esc(join(client.redirect_uris))}" placeholder="https://app.example.com/oauth2/callback" /></label>
    <label>${esc(t("client.scopes"))}${help("help.client.scopes")}
      <input class="c-scopes" value="${esc(join(client.scopes))}" placeholder="openid, profile, email, groups" /></label>
    <label class="checkbox-row">
      <input class="c-public" type="checkbox" ${client.public ? "checked" : ""} /> ${esc(t("client.public"))}${help("help.client.public")}</label>
    <label class="advanced-only">${esc(t("client.grantTypes"))}${help("help.client.grantTypes")}
      <input class="c-grant" value="${esc(join(client.grant_types))}" placeholder="authorization_code, refresh_token" /></label>
    <label class="advanced-only">${esc(t("client.responseTypes"))}${help("help.client.responseTypes")}
      <input class="c-response" value="${esc(join(client.response_types))}" placeholder="code" /></label>
    <label class="advanced-only">${esc(t("client.tokenAuth"))}${help("help.client.tokenAuth")}
      <select class="c-tokenauth">${opts(["", "client_secret_basic", "client_secret_post", "client_secret_jwt", "private_key_jwt", "none"], client.token_endpoint_auth_method)}</select></label>
    <label class="advanced-only checkbox-row">
      <input class="c-reqpkce" type="checkbox" ${client.require_pkce ? "checked" : ""} /> ${esc(t("client.requirePkce"))}${help("help.client.requirePkce")}</label>
    <label class="advanced-only">${esc(t("client.pkceMethod"))}${help("help.client.pkceMethod")}
      <select class="c-pkcemethod">${opts(["", "S256", "plain"], client.pkce_challenge_method)}</select></label>
    <label class="advanced-only">${esc(t("client.accessTokenAlg"))}${help("help.client.accessTokenAlg")}
      <select class="c-atalg">${opts(["", "none", "RS256", "ES256", "PS256"], client.access_token_signed_response_alg)}</select></label>
    <label class="advanced-only">${esc(t("client.userinfoAlg"))}${help("help.client.userinfoAlg")}
      <select class="c-uialg">${opts(["", "none", "RS256", "ES256", "PS256"], client.userinfo_signed_response_alg)}</select></label>
  `;
  box.appendChild(grid);
  grid.querySelector(".btn-hash").onclick = () => hashSecret(grid.querySelector(".c-secret"));
  return box;
}

// Hash an OIDC client secret in place (argon2id, Authelia-compatible). The app
// consuming the client keeps the plaintext; Authelia stores this hash.
async function hashSecret(input) {
  const value = input.value.trim();
  if (!value) return;
  if (value.startsWith("$") && !confirm(t("client.hashConfirm"))) return;
  try {
    const { hash } = await api("/api/hash", { password: value });
    input.value = hash;
    setStatus("genStatus", t("client.hashed"), "ok");
  } catch (e) {
    setStatus("genStatus", t("status.error", { msg: e.message }), "err");
  }
}

function collectClients() {
  const split = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
  return [...document.querySelectorAll("#clientsList .rule")].map((box) => ({
    client_id: box.querySelector(".c-id").value,
    client_name: box.querySelector(".c-name").value,
    client_secret: box.querySelector(".c-secret").value,
    public: box.querySelector(".c-public").checked,
    authorization_policy: box.querySelector(".c-policy").value,
    redirect_uris: split(box.querySelector(".c-redirect").value),
    scopes: split(box.querySelector(".c-scopes").value),
    grant_types: split(box.querySelector(".c-grant").value),
    response_types: split(box.querySelector(".c-response").value),
    token_endpoint_auth_method: box.querySelector(".c-tokenauth").value,
    require_pkce: box.querySelector(".c-reqpkce").checked,
    pkce_challenge_method: box.querySelector(".c-pkcemethod").value,
    access_token_signed_response_alg: box.querySelector(".c-atalg").value,
    userinfo_signed_response_alg: box.querySelector(".c-uialg").value,
  }));
}

function collectConfigBasic() {
  return {
    theme: $("cfg_theme").value,
    log_level: $("cfg_log_level").value,
    server_address: $("cfg_server_address").value,
    session_name: $("cfg_session_name").value,
    session_domain: $("cfg_session_domain").value,
    session_authelia_url: $("cfg_session_authelia_url").value,
    session_expiration: $("cfg_session_expiration").value,
    session_inactivity: $("cfg_session_inactivity").value,
    session_remember_me: $("cfg_session_remember_me").value,
    default_policy: $("cfg_default_policy").value,
    rules: collectRules(),
    oidc_present: !!(state.config.basic && state.config.basic.oidc_present),
    oidc_hmac_secret: $("cfg_oidc_hmac_secret").value,
    oidc_enforce_pkce: $("cfg_oidc_enforce_pkce").value,
    oidc_debug: $("cfg_oidc_debug").checked,
    oidc_ls_access: $("cfg_oidc_ls_access").value,
    oidc_ls_id: $("cfg_oidc_ls_id").value,
    oidc_ls_refresh: $("cfg_oidc_ls_refresh").value,
    oidc_ls_code: $("cfg_oidc_ls_code").value,
    oidc_clients: collectClients(),
  };
}

// ------------------------------------------------------------------ Users
function renderUsers(list) {
  const users = list || state.users.users;
  const container = $("usersList");
  container.innerHTML = "";
  users.forEach((u, i) => container.appendChild(userRow(u, i)));
}

function userRow(user, index) {
  const box = el("div", "user");
  const head = el("div", "user-head");
  const hasHash = !!(user.password && String(user.password).trim());
  head.innerHTML = `<span class="num">${esc(t("user.label", { n: index + 1 }))}</span>
    <span class="badge ${hasHash ? "has-hash" : ""}">${esc(hasHash ? t("user.hashPresent") : t("user.noPassword"))}</span>`;
  const del = el("button", "btn-del", t("common.delete"));
  del.onclick = () => box.remove();
  head.appendChild(del);
  box.appendChild(head);
  // keep the existing hash as hidden data on the element
  box.dataset.password = user.password || "";

  const grid = el("div", "grid");
  grid.innerHTML = `
    <label>${esc(t("user.username"))}${help("help.user.username")}
      <input class="u-username" value="${esc(user.username)}" placeholder="john" /></label>
    <label>${esc(t("user.displayname"))}${help("help.user.displayname")}
      <input class="u-displayname" value="${esc(user.displayname)}" placeholder="John Doe" /></label>
    <label>${esc(t("user.email"))}${help("help.user.email")}
      <input class="u-email" value="${esc(user.email)}" placeholder="john@example.com" /></label>
    <label>${esc(t("user.groups"))}${help("help.user.groups")}
      <input class="u-groups" value="${esc((user.groups || []).join(", "))}" placeholder="admins, dev" /></label>
    <label>${esc(t("user.newPassword"))}${help("help.user.newPassword")}
      <input class="u-newpass" type="text" value="${esc(user.new_password || "")}" placeholder="${esc(t("user.newPasswordPlaceholder"))}" /></label>
    <label class="checkbox-row">
      <input class="u-disabled" type="checkbox" ${user.disabled ? "checked" : ""} /> ${esc(t("user.disabled"))}${help("help.user.disabled")}
    </label>
  `;
  box.appendChild(grid);
  return box;
}

function collectUsers() {
  return [...document.querySelectorAll("#usersList .user")].map((box) => ({
    username: box.querySelector(".u-username").value,
    displayname: box.querySelector(".u-displayname").value,
    email: box.querySelector(".u-email").value,
    groups: box.querySelector(".u-groups").value.split(",").map((s) => s.trim()).filter(Boolean),
    disabled: box.querySelector(".u-disabled").checked,
    password: box.dataset.password || "",
    new_password: box.querySelector(".u-newpass").value || null,
  }));
}

// ------------------------------------------------------------------ Generate
async function generate() {
  const file = state.activeFile;
  setStatus("genStatus", t("status.generating"), "");
  try {
    let yamlOut;
    if (file === "config") {
      const res = await api("/api/config/build", {
        yaml: state.config.raw,
        basic: collectConfigBasic(),
      });
      yamlOut = res.yaml;
    } else {
      const res = await api("/api/users/build", {
        yaml: state.users.raw,
        users: collectUsers(),
      });
      yamlOut = res.yaml;
    }
    // the generated file becomes the new base (subsequent edits start from here)
    state[file].raw = yamlOut;
    state.output[file] = yamlOut;
    refreshRaw();
    refreshOutput();
    // reload the forms from the result (refresh hash badge, normalize)
    await loadText(yamlOut);
    setStatus("genStatus", t("status.generated"), "ok");
  } catch (e) {
    setStatus("genStatus", t("status.error", { msg: e.message }), "err");
  }
}

function download() {
  const file = state.activeFile;
  const blob = new Blob([state.output[file]], { type: "text/yaml" });
  const a = el("a");
  a.href = URL.createObjectURL(blob);
  a.download = FILE_NAMES[file];
  a.click();
  URL.revokeObjectURL(a.href);
}

async function copyOutput() {
  try {
    await navigator.clipboard.writeText(state.output[state.activeFile]);
    setStatus("genStatus", t("status.copied"), "ok");
  } catch (_) {
    setStatus("genStatus", t("status.copyFailed"), "err");
  }
}

// ------------------------------------------------------------------ Samples
const SAMPLE_CONFIG = `---
theme: light
server:
  address: 'tcp://:9091'
log:
  level: info
authentication_backend:
  file:
    path: /config/users_database.yml
access_control:
  default_policy: deny
  rules:
    - domain: 'public.example.com'
      policy: bypass
    - domain: 'secure.example.com'
      policy: two_factor
      subject:
        - 'group:admins'
session:
  name: authelia_session
  expiration: '1h'
  inactivity: '5m'
  remember_me: '1M'
  cookies:
    - domain: 'example.com'
      authelia_url: 'https://auth.example.com'
identity_providers:
  oidc:
    hmac_secret: 'insecure_secret_change_me'
    jwks:
      - key_id: default
        algorithm: RS256
        use: sig
        key: |
          -----BEGIN PRIVATE KEY-----
          REPLACE_WITH_YOUR_PRIVATE_KEY
          -----END PRIVATE KEY-----
    clients:
      - client_id: 'grafana'
        client_name: 'Grafana'
        client_secret: '$pbkdf2-sha512$310000$saltsaltsaltsalt$hashhashhash'
        public: false
        authorization_policy: two_factor
        consent_mode: explicit
        redirect_uris:
          - 'https://grafana.example.com/login/generic_oauth'
        scopes:
          - openid
          - profile
          - email
          - groups
storage:
  local:
    path: /config/db.sqlite3
notifier:
  filesystem:
    filename: /config/notification.txt
`;

const SAMPLE_USERS = `---
users:
  john:
    disabled: false
    displayname: 'John Doe'
    password: '$argon2id$v=19$m=65536,t=3,p=4$YWJjZGVmZ2hpamtsbW5vcA$B0j0qBoZ3v4Q2yZ7uJ2y1H0mE8n7cRk2sT3wQ5xL9aA'
    email: john@example.com
    groups:
      - admins
      - dev
`;

function loadSample() {
  loadText(state.activeFile === "config" ? SAMPLE_CONFIG : SAMPLE_USERS);
}

function loadEmpty() {
  const empty = state.activeFile === "config"
    ? "---\n"
    : "---\nusers: {}\n";
  loadText(empty);
}

// ------------------------------------------------------------------ Utils
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ------------------------------------------------------------------ Language
// Switch language preserving current edits: collect dynamic rows, apply the new
// locale to the static DOM, then re-render the rows with the new translations.
async function changeLanguage(code) {
  const rules = collectRules();
  const users = collectUsers();
  const clients = collectClients();
  await I18n.setLanguage(code);
  renderRules(rules);
  renderUsers(users);
  renderClients(clients);
}

// ------------------------------------------------------------------ Theme
// UI appearance: "system" (follows the OS), "light" or "dark". Persisted in
// localStorage; the actual palette switch is done in CSS via data-theme.
function initTheme() {
  const select = $("themeSelect");
  const saved = localStorage.getItem("ui-theme") || "system";
  document.documentElement.setAttribute("data-theme", saved);
  select.value = saved;
  select.onchange = () => {
    document.documentElement.setAttribute("data-theme", select.value);
    localStorage.setItem("ui-theme", select.value);
  };
}

async function initLanguage() {
  const select = $("langSelect");
  let langs;
  try {
    langs = await I18n.loadLanguages();
  } catch (_) {
    langs = [{ code: "en", name: "English" }];
  }
  select.innerHTML = langs
    .map((l) => `<option value="${esc(l.code)}">${esc(l.name)}</option>`)
    .join("");
  const code = I18n.pick();
  select.value = code;
  await I18n.setLanguage(code);
  select.onchange = () => changeLanguage(select.value);
}

// ------------------------------------------------------------------ Wire up
function wireEvents() {
  document.querySelectorAll(".tab").forEach((tab) =>
    (tab.onclick = () => setActiveFile(tab.dataset.file))
  );
  $("advancedToggle").onchange = (e) => setAdvanced(e.target.checked);

  $("fileInput").onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => loadText(reader.result);
    reader.readAsText(f);
  };
  $("loadSampleBtn").onclick = loadSample;
  $("newBtn").onclick = loadEmpty;

  $("addRuleBtn").onclick = () =>
    $("rulesList").appendChild(ruleRow({ domain: [], policy: "", subject: [], resources: [], networks: [] },
      $("rulesList").children.length));
  $("addUserBtn").onclick = () =>
    $("usersList").appendChild(userRow(
      { username: "", displayname: "", email: "", groups: [], disabled: false, password: "" },
      $("usersList").children.length));
  $("addClientBtn").onclick = () =>
    $("clientsList").appendChild(clientRow(
      { client_id: "", client_name: "", client_secret: "", public: false, authorization_policy: "",
        redirect_uris: [], scopes: [], grant_types: [], response_types: [], token_endpoint_auth_method: "" },
      $("clientsList").children.length));

  $("applyRawBtn").onclick = () => loadText($("rawYaml").value);
  $("generateBtn").onclick = generate;
  $("downloadBtn").onclick = download;
  $("copyBtn").onclick = copyOutput;
}

// Show the app version (from /api/version) next to the project name.
async function initVersion() {
  try {
    const res = await fetch("/api/version");
    const { version } = await res.json();
    if (version) $("appVersion").textContent = "v" + version;
  } catch (_) {
    // non-essential: leave the badge empty if the call fails
  }
}

async function init() {
  wireEvents();
  initTheme();
  initVersion();
  await initLanguage();
  setActiveFile("config");
}

init();
