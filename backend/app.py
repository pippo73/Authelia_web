"""Authelia Config GUI - FastAPI backend.

Single process: serves both the API (/api/*) and the static frontend (/).
Philosophy: surgical edits. On the loaded file we modify ONLY the fields managed
by the forms; comments and untouched sections stay intact (ruamel.yaml).
Advanced mode works directly on the raw YAML.
"""

import io
import json
from pathlib import Path

from argon2 import PasswordHasher, Type
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
LOCALES_DIR = FRONTEND_DIR / "locales"

# Input limits: YAML files are small in practice; argon2 allocates 64 MB per
# hash call, so unbounded inputs would be an easy DoS vector.
MAX_YAML_BYTES = 2_000_000
MAX_PASSWORD_LEN = 1024

# Single source of truth for the app version: the VERSION file at repo root.
try:
    APP_VERSION = (BASE_DIR / "VERSION").read_text(encoding="utf-8").strip()
except OSError:
    APP_VERSION = "dev"

app = FastAPI(title="Authelia Config GUI", version=APP_VERSION)

# Compress larger responses (generated YAML, static JS/CSS).
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Add hardening headers and sane caching to every response."""
    response = await call_next(request)
    headers = response.headers
    headers.setdefault("X-Content-Type-Options", "nosniff")
    headers.setdefault("X-Frame-Options", "DENY")
    headers.setdefault("Referrer-Policy", "no-referrer")
    # 'unsafe-inline' is needed for the inline theme bootstrap script.
    headers.setdefault(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
        "connect-src 'self'; frame-ancestors 'none'",
    )
    if request.url.path.startswith("/api"):
        # API responses carry secrets/hashes: never store them.
        headers.setdefault("Cache-Control", "no-store")
    else:
        # Static assets: always revalidate (ETag/304) so updates apply immediately.
        headers.setdefault("Cache-Control", "no-cache")
    return response

# --- YAML: preserve comments, order, quotes ------------------------------------
yaml = YAML()
yaml.preserve_quotes = True
yaml.width = 4096  # avoid unwanted wrapping of long strings
yaml.indent(mapping=2, sequence=4, offset=2)

# argon2id parameters: Authelia defaults (file backend, v4.38+).
# variant=argon2id, t=3, m=65536 KiB (64 MB), p=4, key=32, salt=16
_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
    type=Type.ID,
)


def load_yaml(text: str):
    try:
        data = yaml.load(text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {exc}")
    return data if data is not None else CommentedMap()


def dump_yaml(data) -> str:
    buf = io.StringIO()
    yaml.dump(data, buf)
    return buf.getvalue()


def as_list(value):
    """Normalize a scalar/list (even nested one level) into a list of strings."""
    if value is None:
        return []
    if isinstance(value, list):
        out = []
        for item in value:
            if isinstance(item, list):
                out.extend(str(x) for x in item)
            else:
                out.append(str(item))
        return out
    return [str(value)]


def get_path(data, *keys, default=None):
    cur = data
    for key in keys:
        if isinstance(cur, dict) and key in cur:
            cur = cur[key]
        else:
            return default
    return cur


def set_path(data, keys, value):
    cur = data
    for key in keys[:-1]:
        if not isinstance(cur.get(key), dict):
            cur[key] = CommentedMap()
        cur = cur[key]
    cur[keys[-1]] = value


# --- Request models ------------------------------------------------------------
class ParseReq(BaseModel):
    yaml: str = Field(default="", max_length=MAX_YAML_BYTES)


class ConfigBuildReq(BaseModel):
    yaml: str = Field(default="", max_length=MAX_YAML_BYTES)
    basic: dict


class UsersBuildReq(BaseModel):
    yaml: str = Field(default="", max_length=MAX_YAML_BYTES)
    users: list


class HashReq(BaseModel):
    password: str = Field(max_length=MAX_PASSWORD_LEN)


# --- configuration.yml ---------------------------------------------------------
def parse_config(text: str) -> dict:
    data = load_yaml(text)
    session = data.get("session") or {}

    domain = session.get("domain", "")
    authelia_url = ""
    cookies = session.get("cookies")
    if isinstance(cookies, list) and cookies and isinstance(cookies[0], dict):
        domain = cookies[0].get("domain", domain)
        authelia_url = cookies[0].get("authelia_url", "")

    ac = data.get("access_control") or {}
    rules = []
    for rule in ac.get("rules") or []:
        rule = rule or {}
        rules.append(
            {
                "domain": as_list(rule.get("domain")),
                "policy": rule.get("policy", ""),
                "subject": as_list(rule.get("subject")),
                "resources": as_list(rule.get("resources")),
                "networks": as_list(rule.get("networks")),
            }
        )

    # identity_providers.oidc (OpenID Connect provider)
    idp = data.get("identity_providers") or {}
    oidc = idp.get("oidc") or {}
    lifespans = oidc.get("lifespans") or {}
    clients = []
    for client in oidc.get("clients") or []:
        client = client or {}
        clients.append(
            {
                "client_id": client.get("client_id", ""),
                "client_name": client.get("client_name", ""),
                "client_secret": client.get("client_secret", ""),
                "public": bool(client.get("public", False)),
                "authorization_policy": client.get("authorization_policy", ""),
                "redirect_uris": as_list(client.get("redirect_uris")),
                "scopes": as_list(client.get("scopes")),
                "grant_types": as_list(client.get("grant_types")),
                "response_types": as_list(client.get("response_types")),
                "token_endpoint_auth_method": client.get("token_endpoint_auth_method", ""),
                "require_pkce": bool(client.get("require_pkce", False)),
                "pkce_challenge_method": client.get("pkce_challenge_method", ""),
                "access_token_signed_response_alg": client.get(
                    "access_token_signed_response_alg", ""
                ),
                "userinfo_signed_response_alg": client.get(
                    "userinfo_signed_response_alg", ""
                ),
                "consent_mode": client.get("consent_mode", ""),
                "pre_configured_consent_duration": str(
                    client.get("pre_configured_consent_duration", "") or ""
                ),
                "response_modes": as_list(client.get("response_modes")),
                "id_token_signed_response_alg": client.get(
                    "id_token_signed_response_alg", ""
                ),
                "authorization_signed_response_alg": client.get(
                    "authorization_signed_response_alg", ""
                ),
                "requested_audience_mode": client.get("requested_audience_mode", ""),
                "lifespan": client.get("lifespan", ""),
                "claims_policy": client.get("claims_policy", ""),
                "audience": as_list(client.get("audience")),
                "sector_identifier_uri": client.get("sector_identifier_uri", ""),
                "request_uris": as_list(client.get("request_uris")),
                "jwks_uri": client.get("jwks_uri", ""),
                "allow_multiple_auth_methods": bool(
                    client.get("allow_multiple_auth_methods", False)
                ),
                "require_pushed_authorization_requests": bool(
                    client.get("require_pushed_authorization_requests", False)
                ),
                "revocation_endpoint_auth_method": client.get(
                    "revocation_endpoint_auth_method", ""
                ),
                "introspection_endpoint_auth_method": client.get(
                    "introspection_endpoint_auth_method", ""
                ),
            }
        )

    return {
        "theme": data.get("theme", ""),
        "log_level": str(get_path(data, "log", "level", default="") or ""),
        "server_address": str(get_path(data, "server", "address", default="") or ""),
        "session_name": session.get("name", ""),
        "session_domain": domain or "",
        "session_authelia_url": authelia_url or "",
        "session_expiration": str(session.get("expiration", "") or ""),
        "session_inactivity": str(session.get("inactivity", "") or ""),
        "session_remember_me": str(
            session.get("remember_me", session.get("remember_me_duration", "")) or ""
        ),
        "default_policy": ac.get("default_policy", ""),
        "rules": rules,
        "oidc_present": bool(idp),
        "oidc_hmac_secret": oidc.get("hmac_secret", ""),
        "oidc_enforce_pkce": oidc.get("enforce_pkce", ""),
        "oidc_debug": bool(oidc.get("enable_client_debug_messages", False)),
        "oidc_ls_access": str(lifespans.get("access_token", "") or ""),
        "oidc_ls_id": str(lifespans.get("id_token", "") or ""),
        "oidc_ls_refresh": str(lifespans.get("refresh_token", "") or ""),
        "oidc_ls_code": str(lifespans.get("authorize_code", "") or ""),
        "oidc_ls_device": str(lifespans.get("device_code", "") or ""),
        "oidc_enable_pkce_plain": bool(oidc.get("enable_pkce_plain_challenge", False)),
        "oidc_stateless_introspection": bool(
            oidc.get("enable_jwt_access_token_stateless_introspection", False)
        ),
        "oidc_discovery_alg": oidc.get("discovery_signed_response_alg", ""),
        "oidc_discovery_key_id": oidc.get("discovery_signed_response_key_id", ""),
        "oidc_require_par": bool(oidc.get("require_pushed_authorization_requests", False)),
        "oidc_min_param_entropy": str(oidc.get("minimum_parameter_entropy", "") or ""),
        "oidc_clients": clients,
    }


def _build_rule(rule: dict) -> CommentedMap:
    out = CommentedMap()
    domains = [d.strip() for d in rule.get("domain", []) if str(d).strip()]
    if len(domains) == 1:
        out["domain"] = domains[0]
    elif domains:
        out["domain"] = domains
    if rule.get("policy"):
        out["policy"] = rule["policy"]
    subjects = [s.strip() for s in rule.get("subject", []) if str(s).strip()]
    if len(subjects) == 1:
        out["subject"] = subjects[0]
    elif subjects:
        out["subject"] = subjects
    resources = [r.strip() for r in rule.get("resources", []) if str(r).strip()]
    if resources:
        out["resources"] = resources
    networks = [n.strip() for n in rule.get("networks", []) if str(n).strip()]
    if networks:
        out["networks"] = networks
    return out


def _build_client(client: dict, base=None) -> CommentedMap:
    """Build an OIDC client mapping. When `base` (the original client from the
    source YAML, matched by client_id) is given, unmanaged keys such as
    consent_mode or pkce_challenge_method are preserved; managed fields are set,
    or removed when cleared in the form."""
    out = base if isinstance(base, CommentedMap) else CommentedMap()

    def put(key, value):
        if value:
            out[key] = value
        elif key in out:
            del out[key]

    put("client_id", client.get("client_id"))
    put("client_name", client.get("client_name"))
    put("client_secret", client.get("client_secret"))
    if client.get("public"):
        out["public"] = True
    elif "public" in out:
        del out["public"]
    put("authorization_policy", client.get("authorization_policy"))
    for key in ("redirect_uris", "scopes", "grant_types", "response_types"):
        put(key, [v.strip() for v in client.get(key, []) if str(v).strip()])
    put("token_endpoint_auth_method", client.get("token_endpoint_auth_method"))
    if client.get("require_pkce"):
        out["require_pkce"] = True
    elif "require_pkce" in out:
        del out["require_pkce"]
    put("pkce_challenge_method", client.get("pkce_challenge_method"))
    put("access_token_signed_response_alg", client.get("access_token_signed_response_alg"))
    put("userinfo_signed_response_alg", client.get("userinfo_signed_response_alg"))
    put("consent_mode", client.get("consent_mode"))
    put("pre_configured_consent_duration", client.get("pre_configured_consent_duration"))
    put("response_modes", [v.strip() for v in client.get("response_modes", []) if str(v).strip()])
    put("id_token_signed_response_alg", client.get("id_token_signed_response_alg"))
    put("authorization_signed_response_alg", client.get("authorization_signed_response_alg"))
    put("requested_audience_mode", client.get("requested_audience_mode"))
    put("lifespan", client.get("lifespan"))
    put("claims_policy", client.get("claims_policy"))
    put("audience", [v.strip() for v in client.get("audience", []) if str(v).strip()])
    put("sector_identifier_uri", client.get("sector_identifier_uri"))
    put("request_uris", [v.strip() for v in client.get("request_uris", []) if str(v).strip()])
    put("jwks_uri", client.get("jwks_uri"))
    put("revocation_endpoint_auth_method", client.get("revocation_endpoint_auth_method"))
    put("introspection_endpoint_auth_method", client.get("introspection_endpoint_auth_method"))
    if client.get("allow_multiple_auth_methods"):
        out["allow_multiple_auth_methods"] = True
    elif "allow_multiple_auth_methods" in out:
        del out["allow_multiple_auth_methods"]
    if client.get("require_pushed_authorization_requests"):
        out["require_pushed_authorization_requests"] = True
    elif "require_pushed_authorization_requests" in out:
        del out["require_pushed_authorization_requests"]
    return out


def build_config(text: str, basic: dict) -> str:
    data = load_yaml(text)

    if basic.get("theme"):
        set_path(data, ["theme"], basic["theme"])
    if basic.get("log_level"):
        set_path(data, ["log", "level"], basic["log_level"])
    if basic.get("server_address"):
        set_path(data, ["server", "address"], basic["server_address"])

    # Session — only create/modify when the file has it or the form provides data
    session_keys = (
        "session_name", "session_expiration", "session_inactivity",
        "session_remember_me", "session_domain", "session_authelia_url",
    )
    if isinstance(data.get("session"), dict) or any(basic.get(k) for k in session_keys):
        if not isinstance(data.get("session"), dict):
            data["session"] = CommentedMap()
        session = data["session"]
        if basic.get("session_name"):
            session["name"] = basic["session_name"]
        if basic.get("session_expiration"):
            session["expiration"] = basic["session_expiration"]
        if basic.get("session_inactivity"):
            session["inactivity"] = basic["session_inactivity"]
        if basic.get("session_remember_me"):
            # write to the already-present key, otherwise use remember_me (v4.38+)
            key = "remember_me_duration" if "remember_me_duration" in session else "remember_me"
            session[key] = basic["session_remember_me"]

        domain = (basic.get("session_domain") or "").strip()
        authelia_url = (basic.get("session_authelia_url") or "").strip()
        cookies = session.get("cookies")
        if isinstance(cookies, list) and cookies and isinstance(cookies[0], dict):
            if domain:
                cookies[0]["domain"] = domain
            if authelia_url:
                cookies[0]["authelia_url"] = authelia_url
        elif domain or authelia_url:
            # v4.38+ schema: session.cookies is a list
            cookie = CommentedMap()
            if domain:
                cookie["domain"] = domain
            if authelia_url:
                cookie["authelia_url"] = authelia_url
            session["cookies"] = [cookie]

    # Access control — same guard: don't inject an empty section
    rules_built = [_build_rule(r) for r in basic.get("rules") or []]
    if isinstance(data.get("access_control"), dict) or basic.get("default_policy") or rules_built:
        if not isinstance(data.get("access_control"), dict):
            data["access_control"] = CommentedMap()
        ac = data["access_control"]
        if basic.get("default_policy"):
            ac["default_policy"] = basic["default_policy"]
        if rules_built or "rules" in ac:
            ac["rules"] = rules_built

    # identity_providers.oidc — only touch it when the file already had it or the
    # form provides OIDC data, so we never inject an empty section into a config
    # that doesn't use OIDC. Untouched keys (jwks, cors, ...) are preserved.
    lifespans = {
        "access_token": basic.get("oidc_ls_access"),
        "authorize_code": basic.get("oidc_ls_code"),
        "id_token": basic.get("oidc_ls_id"),
        "refresh_token": basic.get("oidc_ls_refresh"),
        "device_code": basic.get("oidc_ls_device"),
    }
    lifespans = {k: v for k, v in lifespans.items() if v}
    form_clients = basic.get("oidc_clients") or []
    oidc_active = (
        basic.get("oidc_present")
        or basic.get("oidc_hmac_secret")
        or basic.get("oidc_enforce_pkce")
        or basic.get("oidc_debug")
        or basic.get("oidc_enable_pkce_plain")
        or basic.get("oidc_stateless_introspection")
        or basic.get("oidc_discovery_alg")
        or basic.get("oidc_discovery_key_id")
        or basic.get("oidc_require_par")
        or basic.get("oidc_min_param_entropy")
        or lifespans
        or form_clients
    )
    if oidc_active:
        if not isinstance(data.get("identity_providers"), dict):
            data["identity_providers"] = CommentedMap()
        idp = data["identity_providers"]
        if not isinstance(idp.get("oidc"), dict):
            idp["oidc"] = CommentedMap()
        oidc = idp["oidc"]
        if basic.get("oidc_hmac_secret"):
            oidc["hmac_secret"] = basic["oidc_hmac_secret"]
        if basic.get("oidc_enforce_pkce"):
            oidc["enforce_pkce"] = basic["oidc_enforce_pkce"]
        if basic.get("oidc_debug"):
            oidc["enable_client_debug_messages"] = True
        elif "enable_client_debug_messages" in oidc:
            del oidc["enable_client_debug_messages"]
        if basic.get("oidc_enable_pkce_plain"):
            oidc["enable_pkce_plain_challenge"] = True
        elif "enable_pkce_plain_challenge" in oidc:
            del oidc["enable_pkce_plain_challenge"]
        if basic.get("oidc_stateless_introspection"):
            oidc["enable_jwt_access_token_stateless_introspection"] = True
        elif "enable_jwt_access_token_stateless_introspection" in oidc:
            del oidc["enable_jwt_access_token_stateless_introspection"]
        if basic.get("oidc_require_par"):
            oidc["require_pushed_authorization_requests"] = True
        elif "require_pushed_authorization_requests" in oidc:
            del oidc["require_pushed_authorization_requests"]
        if basic.get("oidc_discovery_alg"):
            oidc["discovery_signed_response_alg"] = basic["oidc_discovery_alg"]
        if basic.get("oidc_discovery_key_id"):
            oidc["discovery_signed_response_key_id"] = basic["oidc_discovery_key_id"]
        if basic.get("oidc_min_param_entropy"):
            try:
                oidc["minimum_parameter_entropy"] = int(basic["oidc_min_param_entropy"])
            except ValueError:
                pass
        if lifespans:
            if not isinstance(oidc.get("lifespans"), dict):
                oidc["lifespans"] = CommentedMap()
            for key, value in lifespans.items():
                oidc["lifespans"][key] = value
        # rebuild clients, merging by client_id to keep unmanaged per-client keys
        existing_by_id = {}
        if isinstance(oidc.get("clients"), list):
            for existing in oidc["clients"]:
                if isinstance(existing, dict) and existing.get("client_id"):
                    existing_by_id[existing["client_id"]] = existing
        if form_clients or "clients" in oidc:
            oidc["clients"] = [
                _build_client(c, existing_by_id.get(c.get("client_id")))
                for c in form_clients
            ]

    return dump_yaml(data)


# --- users_database.yml --------------------------------------------------------
def parse_users(text: str) -> list:
    data = load_yaml(text)
    users = data.get("users") or {}
    out = []
    for username, entry in users.items():
        entry = entry or {}
        out.append(
            {
                "username": username,
                "displayname": entry.get("displayname", ""),
                "email": entry.get("email", ""),
                "groups": [str(g) for g in (entry.get("groups") or [])],
                "disabled": bool(entry.get("disabled", False)),
                "password": entry.get("password", ""),  # existing hash
            }
        )
    return out


def build_users(text: str, users: list) -> str:
    data = load_yaml(text)
    new_users = CommentedMap()
    for user in users:
        username = str(user.get("username", "")).strip()
        if not username:
            continue
        entry = CommentedMap()
        entry["disabled"] = bool(user.get("disabled", False))
        entry["displayname"] = user.get("displayname", "")
        new_password = user.get("new_password")
        if new_password:
            entry["password"] = _hasher.hash(new_password)
        else:
            entry["password"] = user.get("password", "")
        entry["email"] = user.get("email", "")
        groups = [str(g).strip() for g in (user.get("groups") or []) if str(g).strip()]
        if groups:
            entry["groups"] = groups
        new_users[username] = entry
    data["users"] = new_users
    return dump_yaml(data)


# --- API -----------------------------------------------------------------------
@app.post("/api/config/parse")
def api_config_parse(req: ParseReq):
    return {"basic": parse_config(req.yaml)}


@app.post("/api/config/build")
def api_config_build(req: ConfigBuildReq):
    return {"yaml": build_config(req.yaml, req.basic)}


@app.post("/api/users/parse")
def api_users_parse(req: ParseReq):
    return {"users": parse_users(req.yaml)}


@app.post("/api/users/build")
def api_users_build(req: UsersBuildReq):
    return {"yaml": build_users(req.yaml, req.users)}


@app.post("/api/hash")
def api_hash(req: HashReq):
    if not req.password:
        raise HTTPException(status_code=400, detail="Empty password")
    return {"hash": _hasher.hash(req.password)}


@app.get("/api/locales")
def api_locales():
    """List available UI languages by scanning frontend/locales/*.json.

    Add a language by dropping a new <code>.json file in that folder with a
    "_name" field; it shows up here automatically, no code change needed.
    """
    out = []
    if LOCALES_DIR.is_dir():
        for path in sorted(LOCALES_DIR.glob("*.json")):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            out.append({"code": path.stem, "name": data.get("_name", path.stem)})
    return out


@app.get("/api/version")
def api_version():
    return {"version": APP_VERSION}


@app.get("/api/health")
def health():
    return {"status": "ok"}


# --- Static frontend (mounted last so /api takes precedence) -------------------
@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
