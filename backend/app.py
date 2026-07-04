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
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
LOCALES_DIR = FRONTEND_DIR / "locales"

app = FastAPI(title="Authelia Config GUI")

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
    yaml: str = ""


class ConfigBuildReq(BaseModel):
    yaml: str = ""
    basic: dict


class UsersBuildReq(BaseModel):
    yaml: str = ""
    users: list


class HashReq(BaseModel):
    password: str


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


def build_config(text: str, basic: dict) -> str:
    data = load_yaml(text)

    if basic.get("theme"):
        set_path(data, ["theme"], basic["theme"])
    if basic.get("log_level"):
        set_path(data, ["log", "level"], basic["log_level"])
    if basic.get("server_address"):
        set_path(data, ["server", "address"], basic["server_address"])

    # Session
    if "session" not in data or not isinstance(data.get("session"), dict):
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

    # Access control
    if "access_control" not in data or not isinstance(data.get("access_control"), dict):
        data["access_control"] = CommentedMap()
    ac = data["access_control"]
    if basic.get("default_policy"):
        ac["default_policy"] = basic["default_policy"]
    if "rules" in basic:
        ac["rules"] = [_build_rule(r) for r in basic["rules"]]

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


@app.get("/api/health")
def health():
    return {"status": "ok"}


# --- Static frontend (mounted last so /api takes precedence) -------------------
@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
