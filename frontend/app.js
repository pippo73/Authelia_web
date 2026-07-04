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
    <label>${esc(t("rule.domains"))}
      <input class="r-domain" value="${esc(join(rule.domain))}" placeholder="app.example.com" /></label>
    <label>${esc(t("rule.policy"))}
      <select class="r-policy">
        ${["", "deny", "bypass", "one_factor", "two_factor"].map(
          (p) => `<option value="${p}" ${p === (rule.policy || "") ? "selected" : ""}>${p || esc(t("opt.none"))}</option>`
        ).join("")}
      </select></label>
    <label>${esc(t("rule.subject"))}
      <input class="r-subject" value="${esc(join(rule.subject))}" placeholder="group:admins" /></label>
    <label>${esc(t("rule.resources"))}
      <input class="r-resources" value="${esc(join(rule.resources))}" placeholder="^/api/.*$" /></label>
    <label>${esc(t("rule.networks"))}
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
    <label>${esc(t("user.username"))}
      <input class="u-username" value="${esc(user.username)}" placeholder="john" /></label>
    <label>${esc(t("user.displayname"))}
      <input class="u-displayname" value="${esc(user.displayname)}" placeholder="John Doe" /></label>
    <label>${esc(t("user.email"))}
      <input class="u-email" value="${esc(user.email)}" placeholder="john@example.com" /></label>
    <label>${esc(t("user.groups"))}
      <input class="u-groups" value="${esc((user.groups || []).join(", "))}" placeholder="admins, dev" /></label>
    <label>${esc(t("user.newPassword"))}
      <input class="u-newpass" type="text" value="${esc(user.new_password || "")}" placeholder="${esc(t("user.newPasswordPlaceholder"))}" /></label>
    <label class="checkbox-row">
      <input class="u-disabled" type="checkbox" ${user.disabled ? "checked" : ""} /> ${esc(t("user.disabled"))}
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
  await I18n.setLanguage(code);
  renderRules(rules);
  renderUsers(users);
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

  $("applyRawBtn").onclick = () => loadText($("rawYaml").value);
  $("generateBtn").onclick = generate;
  $("downloadBtn").onclick = download;
  $("copyBtn").onclick = copyOutput;
}

async function init() {
  wireEvents();
  await initLanguage();
  setActiveFile("config");
}

init();
