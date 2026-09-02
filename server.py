#!/usr/bin/env python3
"""
hermes-gui-web — a tiny local web UI for changing Hermes Agent configuration.

Reads:  config.yaml / .env / provider_models_cache.json directly (fast).
Writes: ALWAYS via the `hermes` CLI (`config set/unset`, `tools enable/disable`)
        so the CLI's own validation, coercion, backups and env-routing apply.
        We never write config.yaml by hand.

Run:    python server.py [--port 8787] [--no-browser]
Binds 127.0.0.1 only; every request must carry the one-time token printed
at startup (query param `token` or `X-Config-Token` header).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import yaml

DECK_VERSION = "1.0.0"

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------

def detect_hermes_home() -> Path:
    """Resolve HERMES_HOME across Windows, Linux, and macOS."""
    if "HERMES_HOME" in os.environ:
        return Path(os.environ["HERMES_HOME"])

    if os.name == "nt":
        local_app = os.environ.get("LOCALAPPDATA")
        if local_app:
            p = Path(local_app) / "hermes"
            if p.exists():
                return p
        dot_hermes = Path.home() / ".hermes"
        if dot_hermes.exists():
            return dot_hermes
        return Path(local_app or (Path.home() / "AppData" / "Local")) / "hermes"
    else:
        # Standard Linux / macOS location is ~/.hermes
        dot_hermes = Path.home() / ".hermes"
        if dot_hermes.exists():
            return dot_hermes
        xdg_config = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "hermes"
        if xdg_config.exists():
            return xdg_config
        xdg_data = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share")) / "hermes"
        if xdg_data.exists():
            return xdg_data
        return dot_hermes


HERMES_HOME = detect_hermes_home()

CONFIG_PATH = HERMES_HOME / "config.yaml"
ENV_PATH = HERMES_HOME / ".env"
MODELS_CACHE = HERMES_HOME / "provider_models_cache.json"
STATE_DB = HERMES_HOME / "state.db"
STATIC_DIR = Path(__file__).resolve().parent / "static"
ASSETS_DIR = Path(__file__).resolve().parent / "assets"

# Persistent token so the printed URL stays the same across restarts
# (a fresh token per start would break bookmarks / the open tab).
_TOKEN_FILE = Path(__file__).resolve().parent / ".deck-token"
if _TOKEN_FILE.exists():
    _tok = _TOKEN_FILE.read_text(encoding="utf-8").strip()
    TOKEN = _tok if _tok else secrets.token_urlsafe(24)
else:
    TOKEN = secrets.token_urlsafe(24)
    try:
        _TOKEN_FILE.write_text(TOKEN, encoding="utf-8")
    except Exception:
        pass


def find_hermes_exe() -> str | None:
    """Locate the hermes launcher — prefer the venv exe, then PATH."""
    candidates = [
        HERMES_HOME / "hermes-agent" / "venv" / "Scripts" / "hermes.exe",
        HERMES_HOME / "hermes-agent" / "venv" / "bin" / "hermes",
        HERMES_HOME / "bin" / "hermes.exe",
        HERMES_HOME / "bin" / "hermes",
        Path.home() / ".local" / "bin" / "hermes",
        Path("/usr/local/bin/hermes"),
        Path("/usr/bin/hermes"),
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    which = shutil.which("hermes") or shutil.which("hermes.exe")
    if which:
        return which
    return None


HERMES_EXE = find_hermes_exe()


def check_system_requirements() -> dict:
    """Pre-flight check of all system dependencies and Hermes installation."""
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    py_ok = sys.version_info >= (3, 9)

    yaml_ok = False
    try:
        import yaml  # noqa: F401
        yaml_ok = True
    except ImportError:
        pass

    hermes_path = find_hermes_exe()
    hermes_found = bool(hermes_path and Path(hermes_path).exists())
    home_exists = HERMES_HOME.exists()
    config_exists = CONFIG_PATH.exists()
    env_exists = ENV_PATH.exists()

    checks = [
        {
            "id": "python",
            "name": "Python Environment",
            "num": 1,
            "ok": py_ok,
            "status": "ok" if py_ok else "err",
            "title": "Python " + py_ver,
            "detail": f"{sys.executable}",
            "help": "Python 3.10+ is required."
        },
        {
            "id": "pyyaml",
            "name": "Dependencies (PyYAML)",
            "num": 2,
            "ok": yaml_ok,
            "status": "ok" if yaml_ok else "err",
            "title": "PyYAML Installed" if yaml_ok else "PyYAML Missing",
            "detail": "YAML parser library ready" if yaml_ok else "pip install pyyaml",
            "help": "Run: pip install pyyaml"
        },
        {
            "id": "hermes_cli",
            "name": "Hermes Agent CLI",
            "num": 3,
            "ok": hermes_found,
            "status": "ok" if hermes_found else "err",
            "title": "Installed" if hermes_found else "Not installed",
            "detail": hermes_path if hermes_found else f"Not found in {HERMES_HOME} or PATH",
            "help": "Hermes CLI is missing. Install Hermes Agent or copy the hermes folder to this PC."
        },
        {
            "id": "hermes_home",
            "name": "Hermes Data Directory",
            "num": 4,
            "ok": home_exists,
            "status": "ok" if home_exists else "warn",
            "title": "Ready" if home_exists else "Not created yet",
            "detail": str(HERMES_HOME),
            "help": "Stores configurations, caches, and backups."
        },
        {
            "id": "config",
            "name": "Configuration (config.yaml)",
            "num": 5,
            "ok": config_exists,
            "status": "ok" if config_exists else "warn",
            "title": "Present" if config_exists else "Not initialized",
            "detail": str(CONFIG_PATH),
            "help": "Stores models, providers, and settings. Can be restored from a backup."
        },
        {
            "id": "env",
            "name": "Credentials Vault (.env)",
            "num": 6,
            "ok": env_exists,
            "status": "ok" if env_exists else "warn",
            "title": "Present" if env_exists else "Not created yet",
            "detail": str(ENV_PATH),
            "help": "Stores API keys securely. You can set keys directly via this web UI."
        }
    ]

    all_met = py_ok and yaml_ok and hermes_found
    return {
        "ok": True,
        "all_met": all_met,
        "hermes_installed": hermes_found,
        "checks": checks,
        "hermes_exe": hermes_path,
        "hermes_home": str(HERMES_HOME),
        "config_path": str(CONFIG_PATH),
        "env_path": str(ENV_PATH),
    }


# --------------------------------------------------------------------------
# Read helpers
# --------------------------------------------------------------------------

def load_config() -> dict:
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        return {}
    except Exception as e:  # corrupted YAML — surface the error in the UI
        return {"_gui_error": f"config.yaml parse error: {e}"}


def load_env_file() -> dict:
    """Parse .env into an ordered dict (raw values, never sent to the client)."""
    entries: dict[str, str] = {}
    if not ENV_PATH.exists():
        return entries
    try:
        with open(ENV_PATH, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k:
                        entries[k] = v
    except Exception:
        pass
    return entries


SECRET_KEY_RE = re.compile(r"(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)", re.I)


def mask(key: str, value: str) -> str:
    """Mask secret-looking env values (first 3 … last 4); show settings plainly."""
    if value is None:
        return ""
    v = str(value)
    if SECRET_KEY_RE.search(key):
        if len(v) <= 12:
            return "••••••••"
        return f"{v[:3]}…{v[-4:]} (len {len(v)})"
    return v if len(v) <= 60 else v[:57] + "…"


def load_models_cache() -> dict:
    """provider name -> [model ids]."""
    try:
        with open(MODELS_CACHE, encoding="utf-8") as f:
            data = json.load(f)
        return {k: v.get("models", []) for k, v in data.items() if isinstance(v, dict)}
    except Exception:
        return {}


def custom_key_slug(identity: str) -> str:
    """Mirror hermes_cli.config.custom_endpoint_key_env."""
    slug = re.sub(r"[^A-Z0-9]+", "_", str(identity or "").upper()).strip("_")
    return f"HERMES_CUSTOM_{slug}_API_KEY" if slug else "HERMES_CUSTOM_API_KEY"


def resolve_env_ref(value):
    """Resolve ${VAR} references in config values against .env (masked)."""
    if not isinstance(value, str):
        return value
    m = re.fullmatch(r"\$\{([A-Za-z0-9_]+)\}", value.strip())
    if m:
        return {"env_ref": m.group(1)}
    return value


# --------------------------------------------------------------------------
# CLI bridge (the ONLY write path)
# --------------------------------------------------------------------------

def run_hermes(*args: str, timeout: int = 60) -> dict:
    """Run a hermes CLI command; return {ok, stdout, stderr}."""
    exe = find_hermes_exe()
    if not exe:
        return {
            "ok": False,
            "stdout": "",
            "stderr": "Hermes Agent CLI is not installed on this machine.",
            "message": "Hermes CLI not found. Please install Hermes Agent."
        }
    try:
        r = subprocess.run(
            [exe, *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            cwd=str(HERMES_HOME) if HERMES_HOME.exists() else None,
        )
        out = (r.stdout or "").replace("\r", "").strip()
        err = (r.stderr or "").replace("\r", "").strip()
        # `config set` prints warnings (unknown-key notices) to stderr but still
        # exits 0 — keep them visible to the user in the response.
        ok = r.returncode == 0
        return {"ok": ok, "stdout": out, "stderr": err,
                "message": (out if ok else (err or out) or f"exit code {r.returncode}")}
    except subprocess.TimeoutExpired:
        return {"ok": False, "stdout": "", "stderr": "",
                "message": f"`hermes {' '.join(args)}` timed out after {timeout}s"}
    except Exception as e:
        return {"ok": False, "stdout": "", "stderr": "", "message": str(e)}


def resolve_env_value(key: str) -> str | None:
    """Full plaintext value for an env key (from .env)."""
    return load_env_file().get(key)


# --------------------------------------------------------------------------
# .env bridge — uses Hermes' own save_env_value()/remove_env_value() so the
# write path is identical to `hermes gateway setup` (verified).
# --------------------------------------------------------------------------

VENV_PY = HERMES_HOME / "hermes-agent" / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
AGENT_DIR = HERMES_HOME / "hermes-agent"


def env_write(key: str, value: str) -> dict:
    """Write an arbitrary .env key via hermes_cli.config.save_env_value."""
    if not re.fullmatch(r"[A-Za-z0-9_]+", key):
        return {"ok": False, "message": "invalid key name"}
    code = (
        "import sys; sys.path.insert(0, r'{d}'); "
        "from hermes_cli.config import save_env_value; "
        "save_env_value(sys.argv[1], sys.argv[2])"
    ).format(d=AGENT_DIR)
    try:
        r = subprocess.run([str(VENV_PY), "-c", code, key, value],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        if r.returncode == 0:
            return {"ok": True}
        return {"ok": False, "message": (r.stderr or r.stdout or "unknown error").strip()[:300]}
    except Exception as e:
        return {"ok": False, "message": str(e)}


def env_delete(key: str) -> dict:
    """Remove an .env key via hermes_cli.config.remove_env_value."""
    if not re.fullmatch(r"[A-Za-z0-9_]+", key):
        return {"ok": False, "message": "invalid key name"}
    code = (
        "import sys; sys.path.insert(0, r'{d}'); "
        "from hermes_cli.config import remove_env_value; "
        "remove_env_value(sys.argv[1])"
    ).format(d=AGENT_DIR)
    try:
        r = subprocess.run([str(VENV_PY), "-c", code, key],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        if r.returncode == 0:
            return {"ok": True}
        return {"ok": False, "message": (r.stderr or r.stdout or "unknown error").strip()[:300]}
    except Exception as e:
        return {"ok": False, "message": str(e)}


def gateway_running_fast() -> bool:
    """Instant gateway liveness check via the pid file (no CLI call).
    The pid file is JSON: {"pid": N, "kind": ..., ...}"""
    pid_file = HERMES_HOME / "gateway.pid"
    try:
        if not pid_file.exists():
            return False
        data = json.loads(pid_file.read_text(encoding="utf-8", errors="replace"))
        pid = int(data.get("pid"))
        if os.name == "nt":
            import ctypes
            k32 = ctypes.windll.kernel32
            h = k32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
            if not h:
                return False
            k32.CloseHandle(h)
            return True
        else:
            os.kill(pid, 0)
            return True
    except Exception:
        return False


def _gateway_procs() -> list:
    """(pid, ppid) for every live `gateway run` python process."""
    procs = []
    try:
        import subprocess as sp
        if os.name == "nt":
            r = sp.run(["wmic", "process", "where", "name='python.exe'",
                        "get", "ProcessId,ParentProcessId,CommandLine"],
                       capture_output=True, text=True, timeout=30)
            for line in (r.stdout or "").splitlines():
                if "gateway" in line and "run" in line and "hermes" in line:
                    parts = line.split()
                    try:
                        procs.append((int(parts[-1]), int(parts[-2])))  # (pid, ppid)
                    except ValueError:
                        pass
        else:
            r = sp.run(["ps", "-eo", "pid,ppid,args"], capture_output=True, text=True, timeout=15)
            for line in (r.stdout or "").splitlines():
                if "gateway" in line and "run" in line and "hermes" in line:
                    parts = line.split(None, 2)
                    try:
                        procs.append((int(parts[0]), int(parts[1])))
                    except ValueError:
                        pass
    except Exception:
        pass
    return procs


def gateway_instances() -> list:
    """Distinct gateway instances (process trees).

    One gateway = a launcher python that spawns a worker python — TWO
    processes but ONE instance. Counting raw processes gives false
    'duplicate gateway' warnings (kill one, both die — they're a unit).
    Returns a list of per-instance pid lists; len() > 1 means real
    duplicates fighting over the bot's Telegram poll.
    """
    procs = _gateway_procs()
    if not procs:
        return []
    pid_set = {p for p, _ in procs}
    roots = [p for p, pp in procs if pp not in pid_set]
    instances = []
    for root in roots:
        tree = {root}
        changed = True
        while changed:
            changed = False
            for p, pp in procs:
                if pp in tree and p not in tree:
                    tree.add(p)
                    changed = True
        instances.append(sorted(tree))
    return instances


def gateway_pids() -> list:
    """All live gateway process PIDs (any instance)."""
    pids = []
    for inst in gateway_instances():
        pids.extend(inst)
    return pids


def telegram_status() -> dict:
    """Telegram-related .env values + gateway running state."""
    env = load_env_file()
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    allowed = env.get("TELEGRAM_ALLOWED_USERS", "")
    return {
        "token_set": bool(token),
        "token_masked": mask("TELEGRAM_BOT_TOKEN", token) if token else "",
        "allowed_users": [u.strip() for u in allowed.split(",") if u.strip()] if allowed else [],
        "home_channel": env.get("TELEGRAM_HOME_CHANNEL", ""),
        "gateway_running": gateway_running_fast(),
        "gateway_pids": gateway_pids(),
        "gateway_instance_count": len(gateway_instances()),
        "gateway_instances": [", ".join(str(p) for p in inst) for inst in gateway_instances()],
    }


def api_key_for(base_url: str, env_ref: str | None) -> str | None:
    """Resolve the plaintext API key for a base_url from .env."""
    if env_ref:
        v = resolve_env_value(env_ref)
        if v:
            return v
    host = re.sub(r"^https?://", "", base_url or "").split("/")[0]
    return resolve_env_value(custom_key_slug(host))


# --------------------------------------------------------------------------
# State assembly
# --------------------------------------------------------------------------

def build_state() -> dict:
    cfg = load_config()
    env = load_env_file()
    env_masked = [
        {"key": k, "masked": mask(k, v), "set": bool(v)}
        for k, v in env.items()
    ]
    model = cfg.get("model") or {}
    custom_providers = cfg.get("custom_providers") or []

    # annotate custom providers with resolved key info (never plaintext)
    providers_out = []
    for p in custom_providers:
        if not isinstance(p, dict):
            continue
        key_env = p.get("key_env") or custom_key_slug(
            re.sub(r"^https?://", "", str(p.get("base_url", ""))).split("/")[0])
        providers_out.append({
            "name": p.get("name"),
            "base_url": p.get("base_url"),
            "model": p.get("model"),
            "key_env": key_env,
            "key_set": bool(resolve_env_value(key_env)),
            "key_masked": mask(key_env, resolve_env_value(key_env) or ""),
            "models": sorted((p.get("models") or {}).keys()),
            "models_discovered": bool(p.get("models_discovered")),
        })

    # fallback chain (merged new + legacy formats, like the CLI does)
    raw_chain = []
    if isinstance(cfg.get("fallback_providers"), list):
        raw_chain = cfg["fallback_providers"]
    elif isinstance(cfg.get("fallback_model"), dict):
        raw_chain = [cfg["fallback_model"]]
    elif isinstance(cfg.get("fallback_model"), str) and cfg.get("fallback_model"):
        raw_chain = [{"model": cfg["fallback_model"]}]

    chain = []
    for item in raw_chain:
        if isinstance(item, dict):
            p = str(item.get("provider") or "").strip()
            m = str(item.get("model") or "").strip()
            # If provider is empty but model contains "provider/model"
            if not p and "/" in m:
                parts = m.split("/", 1)
                p, m = parts[0], parts[1]
            if not p:
                p = "openrouter"
            chain.append({
                "provider": p,
                "model": m,
                "base_url": str(item.get("base_url") or "")
            })
        elif isinstance(item, str) and item.strip():
            s = item.strip()
            if "/" in s:
                parts = s.split("/", 1)
                chain.append({"provider": parts[0], "model": parts[1], "base_url": ""})
            else:
                chain.append({"provider": "openrouter", "model": s, "base_url": ""})

    version = None
    m = re.search(r"Hermes Agent v([\d.]+)", "")
    try:
        raw = CONFIG_PATH.read_text(encoding="utf-8")
        mm = re.search(r"_config_version:\s*(\d+)", raw)
        if mm:
            version = int(mm.group(1))
    except Exception:
        pass

    std_out = []
    for name, reg in PROVIDER_REGISTRY.items():
        keys = reg.get("keys") or []
        key_env = keys[0] if keys else None
        key_found = False
        for k in keys:
            if resolve_env_value(k):
                key_found = True
                key_env = k
                break
        std_out.append({
            "name": name,
            "base_url": reg.get("base_url"),
            "keys": keys,
            "key_env": key_env,
            "key_needed": bool(keys),
            "key_set": key_found if keys else True,
            "key_masked": mask(key_env, resolve_env_value(key_env) or "") if (key_env and key_found) else None,
            "custom": False,
        })

    return {
        "paths": {
            "config": str(CONFIG_PATH),
            "env": str(ENV_PATH),
            "home": str(HERMES_HOME),
        },
        "config": cfg,
        "config_version": version,
        "deck_version": DECK_VERSION,
        "env_entries": env_masked,
        "model": {
            "default": model.get("default"),
            "provider": model.get("provider"),
            "base_url": model.get("base_url"),
            "api_key": resolve_env_ref(model.get("api_key")),
            "context_length": model.get("context_length"),
            "aliases": model.get("aliases") or {},
        },
        "custom_providers": providers_out,
        "standard_providers": std_out,
        "fallback_chain": chain,
        "model_cache": load_models_cache(),
        "personality_names": sorted((cfg.get("agent", {}).get("personalities") or {}).keys()),
        "system_health": check_system_requirements(),
        "time": time.time(),
    }


# --------------------------------------------------------------------------
# Live provider probes (direct HTTP, read-only)
# --------------------------------------------------------------------------

def http_json(url: str, key: str | None, payload: dict | None = None, timeout: int = 20,
             headers: dict | None = None, x_api_key: bool = False):
    req = urllib.request.Request(url, method="POST" if payload else "GET")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
    if key:
        req.add_header("Authorization", f"Bearer {key}")
        if x_api_key:
            req.add_header("x-api-key", key)
    for hk, hv in (headers or {}).items():
        req.add_header(hk, hv)
    data = json.dumps(payload).encode() if payload else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode()[:400]
        except Exception:
            pass
        raise RuntimeError(f"HTTP {e.code}: {body or e.reason}")
    except Exception as e:
        raise RuntimeError(str(e))


def probe_models(base_url: str, api_key: str | None,
                 headers: dict | None = None, x_api_key: bool = False) -> list[str]:
    url = base_url.rstrip("/") + "/models"
    data = http_json(url, api_key, headers=headers, x_api_key=x_api_key)
    items = data.get("data") if isinstance(data, dict) else None
    if items is None and isinstance(data, list):
        items = data
    if not items:
        # ollama-style: {models: [{name}]}
        alt = data.get("models") if isinstance(data, dict) else None
        if isinstance(alt, list):
            return sorted({m.get("name") or m.get("model") or str(m)
                           for m in alt if isinstance(m, dict)})
        raise RuntimeError(f"No model list in response: {str(data)[:200]}")
    out = set()
    for it in items:
        if isinstance(it, dict):
            out.add(it.get("id") or it.get("name") or "")
        else:
            out.add(str(it))
    return sorted(x for x in out if x)


def probe_chat(base_url: str, api_key: str | None, model: str,
               headers: dict | None = None, x_api_key: bool = False) -> str:
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
        "max_tokens": 8,
        "stream": False,
    }
    data = http_json(url, api_key, payload, timeout=30, headers=headers, x_api_key=x_api_key)
    try:
        txt = data["choices"][0]["message"].get("content", "")
        return f"OK — model replied: {txt.strip()[:80]!r}"
    except Exception:
        return f"Endpoint responded 200 but unexpected shape: {str(data)[:200]}"


def probe_speed(base_url: str, api_key: str | None, model: str,
                test_type: str = "standard",
                custom_prompt: str = "",
                headers: dict | None = None,
                x_api_key: bool = False) -> dict:
    """Benchmark inference speed (TPS, TTFT latency, duration, tokens, rate limits)."""
    presets = {
        "quick": {
            "prompt": "Explain the concept of speed in 2 clear sentences.",
            "max_tokens": 80
        },
        "standard": {
            "prompt": "Explain how modern computers process instructions from code to CPU execution in 3 to 4 concise sentences.",
            "max_tokens": 180
        },
        "heavy": {
            "prompt": "Provide a comprehensive summary of artificial intelligence milestones from the 1950s Turing test to modern LLMs, outlining key breakthroughs in 4-5 sentences.",
            "max_tokens": 350
        }
    }

    config = presets.get(test_type, presets["standard"])
    prompt = custom_prompt.strip() if custom_prompt.strip() else config["prompt"]
    max_tokens = config["max_tokens"]

    is_anthropic = bool(x_api_key and ("anthropic.com" in base_url or (headers and "anthropic-version" in headers)))

    def _execute_streaming(include_stream_options: bool = True):
        if is_anthropic:
            url = base_url.rstrip("/") + "/messages"
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "stream": True
            }
        else:
            url = base_url.rstrip("/") + "/chat/completions"
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "stream": True
            }
            if include_stream_options:
                payload["stream_options"] = {"include_usage": True}

        req = urllib.request.Request(url, method="POST")
        req.add_header("Content-Type", "application/json")
        if api_key:
            req.add_header("Authorization", f"Bearer {api_key}")
            if x_api_key:
                req.add_header("x-api-key", api_key)
        for hk, hv in (headers or {}).items():
            req.add_header(hk, hv)

        data_bytes = json.dumps(payload).encode("utf-8")

        t_start = time.perf_counter()
        t_first_token = None
        collected_text = []
        chunks = []
        reported_usage = {}
        rate_limits = {}

        with urllib.request.urlopen(req, data=data_bytes, timeout=45) as resp:
            for hk, hv in resp.headers.items():
                lhk = hk.lower()
                if "ratelimit" in lhk or lhk in ("retry-after", "openai-processing-ms", "x-request-id", "cf-ray"):
                    rate_limits[hk] = hv

            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line:
                    continue
                if line.startswith("data:"):
                    chunk_data = line[5:].strip()
                    if chunk_data == "[DONE]":
                        break
                    try:
                        obj = json.loads(chunk_data)
                    except Exception:
                        continue

                    text_piece = ""
                    if "choices" in obj and isinstance(obj["choices"], list) and obj["choices"]:
                        delta = obj["choices"][0].get("delta", {})
                        text_piece = delta.get("content") or delta.get("text") or ""
                    elif obj.get("type") == "content_block_delta":
                        text_piece = obj.get("delta", {}).get("text", "")
                    elif obj.get("type") == "message_start":
                        usage_in_msg = obj.get("message", {}).get("usage")
                        if usage_in_msg:
                            reported_usage.update(usage_in_msg)
                    elif obj.get("type") == "message_delta":
                        usage_in_delta = obj.get("usage")
                        if usage_in_delta:
                            reported_usage.update(usage_in_delta)

                    if "usage" in obj and obj["usage"]:
                        reported_usage.update(obj["usage"])

                    if text_piece:
                        now = time.perf_counter()
                        if t_first_token is None:
                            t_first_token = now
                        chunks.append((now, len(text_piece)))
                        collected_text.append(text_piece)

        t_end = time.perf_counter()
        return t_start, t_first_token, t_end, collected_text, chunks, reported_usage, rate_limits

    def _execute_non_streaming():
        if is_anthropic:
            url = base_url.rstrip("/") + "/messages"
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "stream": False
            }
        else:
            url = base_url.rstrip("/") + "/chat/completions"
            payload = {
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "stream": False
            }

        req = urllib.request.Request(url, method="POST")
        req.add_header("Content-Type", "application/json")
        if api_key:
            req.add_header("Authorization", f"Bearer {api_key}")
            if x_api_key:
                req.add_header("x-api-key", api_key)
        for hk, hv in (headers or {}).items():
            req.add_header(hk, hv)

        data_bytes = json.dumps(payload).encode("utf-8")
        t_start = time.perf_counter()
        with urllib.request.urlopen(req, data=data_bytes, timeout=45) as resp:
            rate_limits = {}
            for hk, hv in resp.headers.items():
                lhk = hk.lower()
                if "ratelimit" in lhk or lhk in ("retry-after", "openai-processing-ms", "x-request-id", "cf-ray"):
                    rate_limits[hk] = hv
            body_data = json.loads(resp.read().decode("utf-8", errors="replace") or "{}")
        t_end = time.perf_counter()

        text_out = ""
        reported_usage = body_data.get("usage") or {}
        if "choices" in body_data and body_data["choices"]:
            msg = body_data["choices"][0].get("message", {})
            text_out = msg.get("content") or ""
        elif "content" in body_data and isinstance(body_data["content"], list) and body_data["content"]:
            text_out = body_data["content"][0].get("text") or ""

        return t_start, t_end, t_end, [text_out], [], reported_usage, rate_limits

    try:
        t_start, t_first_token, t_end, collected_text, chunks, reported_usage, rate_limits = _execute_streaming(True)
    except urllib.error.HTTPError as e:
        if e.code in (400, 422) and not is_anthropic:
            try:
                t_start, t_first_token, t_end, collected_text, chunks, reported_usage, rate_limits = _execute_streaming(False)
            except Exception:
                try:
                    t_start, t_first_token, t_end, collected_text, chunks, reported_usage, rate_limits = _execute_non_streaming()
                except Exception as e3:
                    raise RuntimeError(f"HTTP {e.code}: {e3}")
        else:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:400]
            except Exception:
                pass
            raise RuntimeError(f"HTTP {e.code}: {body or e.reason}")
    except Exception as e:
        try:
            t_start, t_first_token, t_end, collected_text, chunks, reported_usage, rate_limits = _execute_non_streaming()
        except Exception:
            raise RuntimeError(str(e))

    full_text = "".join(collected_text).strip()
    total_time_s = max(0.001, round(t_end - t_start, 3))
    ttft_s = (t_first_token - t_start) if t_first_token is not None else total_time_s
    ttft_ms = max(0.1, round(ttft_s * 1000, 1))
    gen_time_s = max(0.001, round(t_end - (t_first_token or t_start), 3))

    comp_tokens = 0
    prompt_tokens = 0
    if reported_usage:
        comp_tokens = reported_usage.get("completion_tokens") or reported_usage.get("output_tokens") or 0
        prompt_tokens = reported_usage.get("prompt_tokens") or reported_usage.get("input_tokens") or 0

    if not comp_tokens and full_text:
        comp_tokens = max(1, round(len(full_text) / 3.8))
    if not prompt_tokens:
        prompt_tokens = max(1, round(len(prompt) / 3.8))

    total_tokens = prompt_tokens + comp_tokens

    # If stream was delivered in a single chunk or buffered by provider, use total duration for throughput
    if len(chunks) <= 1 or gen_time_s < 0.05:
        effective_gen_s = max(0.001, total_time_s)
    else:
        effective_gen_s = gen_time_s

    tps = round(comp_tokens / effective_gen_s, 1)
    total_tps = round(comp_tokens / max(0.001, total_time_s), 1)
    chars_per_sec = round(len(full_text) / effective_gen_s, 1)
    words_count = len(full_text.split())
    words_per_sec = round(words_count / effective_gen_s, 1)

    if tps >= 100:
        tier = "blazing"
        tier_label = "Blazing Fast 🚀"
    elif tps >= 50:
        tier = "fast"
        tier_label = "Fast ⚡"
    elif tps >= 25:
        tier = "standard"
        tier_label = "Standard 🟢"
    elif tps >= 12:
        tier = "moderate"
        tier_label = "Moderate 🟡"
    else:
        tier = "capped"
        tier_label = "Capped / Slow 🔴"

    throttling_note = None
    if tps < 12:
        throttling_note = "Speed is below 12 TPS. This model appears capped or throttled, which is typical for free-tier endpoints or heavily shared servers."
    elif ttft_ms > 2500:
        throttling_note = f"High initial latency (TTFT {ttft_ms}ms). The provider may be experiencing queue congestion or cold-start overhead."

    return {
        "ok": True,
        "model": model,
        "test_type": test_type,
        "tps": tps,
        "total_tps": total_tps,
        "ttft_ms": ttft_ms,
        "total_time_s": total_time_s,
        "gen_time_s": gen_time_s,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": comp_tokens,
        "total_tokens": total_tokens,
        "chars_count": len(full_text),
        "chars_per_sec": chars_per_sec,
        "words_count": words_count,
        "words_per_sec": words_per_sec,
        "chunk_count": len(chunks),
        "tier": tier,
        "tier_label": tier_label,
        "throttling_note": throttling_note,
        "rate_limits": rate_limits,
        "sample_text": full_text[:500] + ("…" if len(full_text) > 500 else ""),
    }


# --------------------------------------------------------------------------
# Provider registry — how to reach named providers for live "Find models"
# --------------------------------------------------------------------------

PROVIDER_REGISTRY: dict = {
    "openrouter":     {"base_url": "https://openrouter.ai/api/v1", "keys": ["OPENROUTER_API_KEY", "HERMES_CUSTOM_OPENROUTER_AI_API_KEY"]},
    "openai":         {"base_url": "https://api.openai.com/v1", "keys": ["OPENAI_API_KEY", "HERMES_CUSTOM_API_OPENAI_COM_API_KEY"]},
    "anthropic":      {"base_url": "https://api.anthropic.com/v1", "keys": ["ANTHROPIC_API_KEY", "HERMES_CUSTOM_API_ANTHROPIC_COM_API_KEY"],
                       "headers": {"anthropic-version": "2023-06-01"}, "x_api_key": True},
    "deepseek":       {"base_url": "https://api.deepseek.com/v1", "keys": ["DEEPSEEK_API_KEY", "HERMES_CUSTOM_API_DEEPSEEK_COM_API_KEY"]},
    "gemini":         {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
                       "keys": ["GOOGLE_API_KEY", "GEMINI_API_KEY"]},
    "xai":            {"base_url": "https://api.x.ai/v1", "keys": ["XAI_API_KEY"]},
    "zai":            {"base_url": "https://api.z.ai/api/paas/v4", "keys": ["GLM_API_KEY", "ZAI_API_KEY"]},
    "mistral":        {"base_url": "https://api.mistral.ai/v1", "keys": ["MISTRAL_API_KEY"]},
    "groq":           {"base_url": "https://api.groq.com/openai/v1", "keys": ["GROQ_API_KEY", "HERMES_CUSTOM_API_GROQ_COM_API_KEY"]},
    "minimax":        {"base_url": "https://api.minimaxi.com/v1", "keys": ["MINIMAX_API_KEY"]},
    "minimax-cn":     {"base_url": "https://api.minimaxi.cn/v1", "keys": ["MINIMAX_CN_API_KEY"]},
    "kimi-coding":    {"base_url": "https://api.moonshot.ai/v1", "keys": ["KIMI_API_KEY"]},
    "kimi-coding-cn": {"base_url": "https://api.moonshot.cn/v1", "keys": ["KIMI_CN_API_KEY"]},
    "alibaba":        {"base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "keys": ["DASHSCOPE_API_KEY"]},
    "huggingface":    {"base_url": "https://router.huggingface.co/v1", "keys": ["HF_TOKEN"]},
    "fireworks":      {"base_url": "https://api.fireworks.ai/inference/v1", "keys": ["FIREWORKS_API_KEY"]},
    "novita":         {"base_url": "https://api.novita.ai/v3/openai", "keys": ["NOVITA_API_KEY"]},
    "nvidia":         {"base_url": "https://integrate.api.nvidia.com/v1", "keys": ["NVIDIA_API_KEY"]},
    "deepinfra":      {"base_url": "https://api.deepinfra.com/v1/openai", "keys": ["DEEPINFRA_API_KEY"]},
    "stepfun":        {"base_url": "https://api.stepfun.com/v1", "keys": ["STEPFUN_API_KEY"]},
    "upstage":        {"base_url": "https://api.upstage.ai/v1", "keys": ["UPSTAGE_API_KEY"]},
    "together":       {"base_url": "https://api.together.xyz/v1", "keys": ["TOGETHER_API_KEY"]},
    "nous":           {"base_url": "https://inference-api.nousresearch.com/v1", "keys": ["NOUS_API_KEY"]},
    "ollama":         {"base_url": "http://localhost:11434/v1", "keys": []},
    "ollama-cloud":   {"base_url": "https://ollama.com/v1", "keys": ["OLLAMA_CLOUD_API_KEY"]},
    "tokenrouter":    {"base_url": "https://api.tokenrouter.com/v1", "keys": ["HERMES_CUSTOM_API_TOKENROUTER_COM_API_KEY", "TOKENROUTER_API_KEY"]},
    "opencode":       {"base_url": "https://opencode.ai/zen/v1", "keys": ["HERMES_CUSTOM_OPENCODE_AI_API_KEY", "OPENCODE_API_KEY"]},
    "opencode-free":  {"base_url": "https://opencode.ai/zen/v1", "keys": ["HERMES_CUSTOM_OPENCODE_AI_API_KEY", "OPENCODE_API_KEY"]},
    "opencode-zen":   {"base_url": "https://opencode.ai/zen/v1", "keys": ["HERMES_CUSTOM_OPENCODE_AI_API_KEY", "OPENCODE_API_KEY"]},
}

OAUTH_ONLY_PROVIDERS = {"copilot", "copilot-acp", "openai-codex", "qwen-oauth", "minimax-oauth"}


def resolve_provider_target(provider: str, base_url: str = ""):
    """Map a provider name (+ optional explicit URL) to a live-probe target."""
    provider = (provider or "").strip()
    p_norm = re.sub(r"[^a-z0-9]", "", provider.lower())
    cfg = load_config()
    cps = [x for x in (cfg.get("custom_providers") or []) if isinstance(x, dict)]

    # 1. Search custom providers by exact name, normalized slug, or substring
    cp = next((x for x in cps if x.get("name") == provider), None)
    if not cp:
        cp = next((x for x in cps if re.sub(r"[^a-z0-9]", "", str(x.get("name", "")).lower()) == p_norm), None)
    if not cp and "opencode" in p_norm:
        cp = next((x for x in cps if "opencode" in str(x.get("name", "")).lower() or "opencode" in str(x.get("base_url", "")).lower()), None)
    if not cp and "tokenrouter" in p_norm:
        cp = next((x for x in cps if "tokenrouter" in str(x.get("name", "")).lower() or "tokenrouter" in str(x.get("base_url", "")).lower()), None)
    if not cp and "groq" in p_norm:
        cp = next((x for x in cps if "groq" in str(x.get("name", "")).lower() or "groq" in str(x.get("base_url", "")).lower()), None)
    if not cp and "openrouter" in p_norm and provider.lower() != "openrouter":
        cp = next((x for x in cps if "openrouter" in str(x.get("name", "")).lower()), None)

    if base_url:
        host = re.sub(r"^https?://", "", base_url).split("/")[0]
        cands = []
        if cp and cp.get("key_env"):
            cands.append(cp.get("key_env"))
        cands.append(custom_key_slug(host))
        return {
            "base_url": base_url.rstrip("/"),
            "key_env": cands[0] if cands else None,
            "key_candidates": cands,
            "headers": {}, "x_api_key": False, "key_needed": True,
        }
    if cp:
        base = (cp.get("base_url") or "").rstrip("/")
        host = re.sub(r"^https?://", "", base).split("/")[0]
        key_env = cp.get("key_env") or custom_key_slug(host)
        return {
            "base_url": base,
            "key_env": key_env,
            "key_candidates": [key_env, custom_key_slug(host)],
            "headers": {}, "x_api_key": False, "key_needed": True,
        }

    # 2. Check PROVIDER_REGISTRY (exact or normalized)
    reg = PROVIDER_REGISTRY.get(provider) or PROVIDER_REGISTRY.get(provider.lower())
    if not reg:
        for rk, rv in PROVIDER_REGISTRY.items():
            if re.sub(r"[^a-z0-9]", "", rk.lower()) == p_norm:
                reg = rv
                break
    if reg:
        return {
            "base_url": reg["base_url"].rstrip("/"),
            "key_env": None,
            "key_candidates": reg.get("keys", []),
            "headers": reg.get("headers", {}),
            "x_api_key": bool(reg.get("x_api_key")),
            "key_needed": bool(reg.get("keys")),
        }
    if provider in OAUTH_ONLY_PROVIDERS or provider.lower() in OAUTH_ONLY_PROVIDERS:
        return {"oauth": True, "message":
                f"'{provider}' logs in with OAuth (hermes auth add {provider}), not an API key — "
                "this panel can't test it directly."}
    return None


# --------------------------------------------------------------------------
# Toolset list parsing (hermes tools list --platform X)
# --------------------------------------------------------------------------

TOOL_LINE = re.compile(
    r"^\s*(✓ enabled|✗ disabled)\s+(\S+)\s+(.*?)\s*$"
)


def parse_tools_output(text: str) -> list[dict]:
    tools: list[dict] = []
    for line in text.splitlines():
        m = TOOL_LINE.match(line)
        if not m:
            continue
        enabled = m.group(1).startswith("✓")
        name = m.group(2)
        rest = m.group(3)
        # leading emoji icon + description
        icon = ""
        em = re.match(r"^(\S)\s+(.*)$", rest)
        if em and not em.group(1)[0].isalnum():
            icon, rest = em.group(1), em.group(2)
        tools.append({"name": name, "enabled": enabled, "icon": icon, "desc": rest})
    return tools


# --------------------------------------------------------------------------
# Chat bridge — run real Hermes turns via `hermes chat -q -Q --query-file -`
# stdout = final reply, stderr = banners + `session_id: <id>` line.
# --------------------------------------------------------------------------

CHAT_STATE = {"busy": False, "session_id": None, "turn_started": 0}


def _session_stats(session_id: str, since_ts: float | None = None) -> dict:
    """Read-only stats for one chat session from state.db (model, cwd, tokens,
    cache, per-reply timing). `since_ts` limits token counters to messages newer
    than it (used to compute the per-turn delta on resume)."""
    import sqlite3
    out: dict = {}
    try:
        con = sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        try:
            s = con.execute(
                "SELECT model, cwd, started_at, ended_at, last_activity_at, "
                "message_count, tool_call_count, api_call_count, input_tokens, output_tokens, "
                "cache_read_tokens, cache_write_tokens, reasoning_tokens, estimated_cost_usd, "
                "billing_provider, billing_base_url, model_config "
                "FROM sessions WHERE id=?", (session_id,)).fetchone()
            if s:
                prov = s["billing_provider"] if "billing_provider" in s.keys() else None
                if not prov and "model_config" in s.keys() and s["model_config"]:
                    try:
                        mc = json.loads(s["model_config"])
                        prov = mc.get("provider") or mc.get("gateway_runtime", {}).get("provider")
                    except Exception:
                        pass

                out = {
                    "model": s["model"],
                    "provider": prov or "",
                    "base_url": (s["billing_base_url"] if "billing_base_url" in s.keys() else "") or "",
                    "cwd": s["cwd"],
                    "session_started_at": s["started_at"],
                    "session_ended_at": s["ended_at"],
                    "message_count": s["message_count"],
                    "tool_calls": s["tool_call_count"],
                    "api_calls": s["api_call_count"],
                    "input_tokens": s["input_tokens"],
                    "output_tokens": s["output_tokens"],
                    "cache_read": s["cache_read_tokens"],
                    "cache_write": s["cache_write_tokens"],
                    "reasoning_tokens": s["reasoning_tokens"],
                    "cost_usd": s["estimated_cost_usd"],
                }

                # active context tokens: estimate from current uncompacted active messages
                m_rows = con.execute(
                    "SELECT role, content, tool_calls FROM messages WHERE session_id=? AND active=1",
                    (session_id,)
                ).fetchall()
                if m_rows:
                    try:
                        sys.path.insert(0, str(AGENT_DIR))
                        from agent.model_metadata import estimate_messages_tokens_rough
                        active_list = [{"role": mr["role"], "content": mr["content"] or "", "tool_calls": mr["tool_calls"]} for mr in m_rows]
                        out["context_tokens"] = estimate_messages_tokens_rough(active_list)
                    except Exception:
                        chars = sum(len(str(mr["content"] or "")) + (len(str(mr["tool_calls"])) if mr["tool_calls"] else 0) + 60 for mr in m_rows)
                        out["context_tokens"] = max(1, (chars + 3) // 4)
                else:
                    out["context_tokens"] = 0
            # per-reply timing: last user msg ts -> following assistant msg ts
            rows = con.execute(
                "SELECT role, timestamp FROM messages "
                "WHERE session_id=? AND active=1 AND role IN ('user','assistant') "
                "AND (tool_calls IS NULL OR tool_calls='') "
                "AND content IS NOT NULL AND TRIM(content)<>'' "
                "ORDER BY id DESC LIMIT 4", (session_id,)).fetchall()
            rows = list(reversed(rows))
            last_user = last_asst = None
            for r in rows:
                if r["role"] == "user" and last_user is None:
                    last_user = r["timestamp"]
                if r["role"] == "assistant" and last_asst is None:
                    last_asst = r["timestamp"]
            if last_user and last_asst and last_asst >= last_user:
                out["reply_s"] = round(last_asst - last_user, 1)
        finally:
            con.close()
    except Exception:
        pass
    return out


def chat_send(message: str, resume_id: str | None = None) -> dict:
    """One agent turn. Returns {ok, reply, session_id, duration_s} plus live
    stats pulled from the Hermes session store right after the turn:
    model, cwd, cache_read/write, input/output/reasoning tokens, reply timing.
    """
    if CHAT_STATE["busy"]:
        return {"ok": False, "message": "A reply is still being written — wait for it to finish first."}
    CHAT_STATE["busy"] = True
    CHAT_STATE["turn_started"] = time.time()
    try:
        args = [HERMES_EXE, "chat", "-Q", "--query-file", "-"]
        if resume_id:
            args += ["--resume", resume_id]
        try:
            r = subprocess.run(
                args,
                input=message,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=1800,
                cwd=str(HERMES_HOME),
            )
        except subprocess.TimeoutExpired:
            return {"ok": False, "message": "The agent ran for 30 minutes without finishing — stopped."}

        out = (r.stdout or "").replace("\r", "").strip()
        err = (r.stderr or "").replace("\r", "").strip()
        session_id = None
        m = re.search(r"^session_id:\s+(\S+)", err, re.MULTILINE)
        if m:
            session_id = m.group(1)
        if r.returncode != 0 and not out:
            return {"ok": False,
                    "message": (err or out or f"exit {r.returncode}").strip()[:800] or "no output"}
        if session_id:
            CHAT_STATE["session_id"] = session_id

        result = {"ok": True, "reply": out, "session_id": session_id,
                  "duration_s": round(time.time() - CHAT_STATE["turn_started"], 1)}
        # authoritative stats from the session store (Hermes writes them itself)
        if session_id:
            time.sleep(0.2)  # let the writer commit
            result.update(_session_stats(session_id))
        return result
    finally:
        CHAT_STATE["busy"] = False


def chat_compress(session_id: str | None, args: str = "") -> dict:
    """Trigger context compression for a conversation session using Hermes's built-in /compress."""
    if not session_id or not re.fullmatch(r"[A-Za-z0-9_\-]+", session_id):
        return {"ok": False, "message": "No active conversation to compress. Select or start a chat first."}
    if CHAT_STATE["busy"]:
        return {"ok": False, "message": "A reply is currently running. Please wait for it to finish first."}

    CHAT_STATE["busy"] = True
    t0 = time.time()
    try:
        clean_args = args.strip()
        code = f"""
import sys, os, io, contextlib, json
from pathlib import Path
AGENT_DIR = Path(r'{AGENT_DIR}')
sys.path.insert(0, str(AGENT_DIR))
from cli import HermesCLI
from tools.ansi_strip import strip_ansi

os.environ['HERMES_INTERACTIVE'] = '1'
os.environ['HERMES_SESSION_KEY'] = '{session_id}'

cli = HermesCLI(resume='{session_id}', compact=True, verbose=False)
if not cli._preload_resumed_session():
    print(json.dumps({{'ok': False, 'message': 'Could not load conversation history to compress.'}}))
    sys.exit(0)

cli._ensure_runtime_credentials()
cli._init_agent()

buf = io.StringIO()
cmd = '/compress ' + {repr(clean_args)}.strip()
with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
    cli.process_command(cmd.strip())

out = strip_ansi(buf.getvalue().strip())
print(json.dumps({{'ok': True, 'output': out, 'session_id': cli.session_id}}))
"""
        r = subprocess.run(
            [str(VENV_PY), "-c", code],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
            cwd=str(HERMES_HOME),
        )
        if r.returncode == 0:
            lines = [l.strip() for l in r.stdout.strip().splitlines() if l.strip().startswith("{") and l.strip().endswith("}")]
            out_dict = None
            if lines:
                try:
                    out_dict = json.loads(lines[-1])
                except Exception:
                    pass
            if not out_dict:
                out_dict = {"ok": True, "output": r.stdout.strip(), "session_id": session_id}

            new_sid = out_dict.get("session_id") or session_id
            if new_sid:
                CHAT_STATE["session_id"] = new_sid
            out_dict["duration_s"] = round(time.time() - t0, 1)

            # Persist compression result into SQLite messages table so it stays on page refresh
            out_text = out_dict.get("output", "").strip()
            target_sid = new_sid or session_id
            if target_sid and out_text:
                try:
                    with sqlite3.connect(str(STATE_DB)) as con:
                        con.execute(
                            "INSERT INTO messages (session_id, role, content, timestamp, active) VALUES (?, 'assistant', ?, ?, 1)",
                            (target_sid, out_text, time.time())
                        )
                        con.commit()
                except Exception:
                    pass

            return out_dict

        raw_err = (r.stderr or r.stdout or f"exit {r.returncode}").strip()
        if "context creation timeout" in raw_err.lower():
            err_msg = "⚠️ Context creation timed out on the model provider (e.g. Ollama Cloud). The provider took too long allocating context on GPU. Please try again or switch to a faster provider in Model settings."
        else:
            err_msg = raw_err[:800]
        return {"ok": False, "message": err_msg}
    except subprocess.TimeoutExpired:
        return {"ok": False, "message": "Compression timed out after 3 minutes."}
    except Exception as e:
        return {"ok": False, "message": str(e)}
    finally:
        CHAT_STATE["busy"] = False


def chat_history(session_id: str | None, limit: int = 400) -> dict:
    """Read-only transcript pull from the SQLite session store (no CLI, instant)."""
    import sqlite3
    try:
        con = sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        if session_id and not re.fullmatch(r"[A-Za-z0-9_\-]+", session_id):
            return {"ok": False, "message": "invalid session id"}
        if session_id:
            rows = con.execute(
                "SELECT role, content, timestamp FROM messages "
                "WHERE session_id=? AND active=1 AND role IN ('user','assistant') "
                "AND (tool_calls IS NULL OR tool_calls='') "
                "AND content IS NOT NULL AND TRIM(content)<>'' "
                "ORDER BY id LIMIT ?",
                (session_id, limit)).fetchall()
            msgs = [{"role": r["role"], "content": r["content"], "t": r["timestamp"]} for r in rows]
            return {"ok": True, "session_id": session_id, "messages": msgs}
        # recent sessions list
        rows = con.execute(
            "SELECT id, title, message_count, model, source, last_activity_at "
            "FROM sessions WHERE hidden=0 AND archived=0 "
            "ORDER BY last_activity_at DESC LIMIT 40").fetchall()
        out = []
        for r in rows:
            out.append({"id": r["id"], "title": r["title"] or "(untitled)",
                        "messages": r["message_count"], "model": r["model"],
                        "source": r["source"], "last": r["last_activity_at"]})
        return {"ok": True, "sessions": out}
    except Exception as e:
        return {"ok": False, "message": str(e)}
    finally:
        try:
            con.close()
        except Exception:
            pass






def chat_stats(session_id: str | None) -> dict:
    """Model + context window + session stats for the chat page HUD.

    - context limit: Hermes' own resolver (agent.model_metadata), honoring
      model.context_length overrides and custom_providers per-model values —
      the same number the terminal bar shows as its 100% mark.
    - session stats: read-only from state.db (tokens, cache, timing, cwd).
    """
    cfg = load_config()
    model_cfg = cfg.get("model") or {}
    model = model_cfg.get("default") or ""
    provider = model_cfg.get("provider") or ""
    base_url = model_cfg.get("base_url") or ""
    out: dict = {"ok": True, "model": model, "provider": provider}

    # context window — resolve like the terminal does
    try:
        sys.path.insert(0, str(AGENT_DIR))
        from agent.model_metadata import get_model_context_length
        ctx = get_model_context_length(
            model,
            base_url,
            resolve_env_value(model_cfg.get("api_key", "")) if isinstance(model_cfg.get("api_key"), str) else "",
            model_cfg.get("context_length"),
            provider,
            cfg.get("custom_providers"),
        )
        if isinstance(ctx, int) and ctx > 0:
            out["context_length"] = ctx
    except Exception as e:
        out["ctx_error"] = str(e)[:200]

    # .env api key presence (masked) for the model
    if isinstance(model_cfg.get("api_key"), str):
        m = re.fullmatch(r"\$\{([A-Za-z0-9_]+)\}", model_cfg.get("api_key", "").strip())
        if m:
            v = resolve_env_value(m.group(1))
            out["api_key_env"] = m.group(1)
            out["api_key_set"] = bool(v)

    if session_id:
        if not re.fullmatch(r"[A-Za-z0-9_\-]+", session_id):
            return {"ok": False, "message": "invalid session id"}
        sess = _session_stats(session_id)
        out.update(sess)
        if sess.get("model") and sess.get("model") != model:
            try:
                sys.path.insert(0, str(AGENT_DIR))
                from agent.model_metadata import get_model_context_length
                ctx = get_model_context_length(
                    sess["model"],
                    sess.get("base_url") or base_url,
                    resolve_env_value(model_cfg.get("api_key", "")) if isinstance(model_cfg.get("api_key"), str) else "",
                    model_cfg.get("context_length"),
                    sess.get("provider") or provider,
                    cfg.get("custom_providers"),
                )
                if isinstance(ctx, int) and ctx > 0:
                    out["context_length"] = ctx
            except Exception:
                pass
    return out


# --------------------------------------------------------------------------
# Dashboard Overview (Home Page Intelligence)
# --------------------------------------------------------------------------
def dashboard_overview() -> dict:
    """Aggregated stats for the Home page dashboard."""
    cfg = load_config()
    out = {
        "ok": True,
        "totals": {
            "sessions": 0, "messages": 0, "tool_calls": 0,
            "input_tokens": 0, "output_tokens": 0, "cache_read_tokens": 0,
            "cache_savings_pct": 0,
        },
        "recent_sessions": [],
        "memory": {
            "enabled": bool(cfg.get("memory", {}).get("memory_enabled", True)),
            "user_profile": bool(cfg.get("memory", {}).get("user_profile_enabled", True)),
            "char_limit": int(cfg.get("memory", {}).get("memory_char_limit", 10000)),
            "used_chars": 0,
            "snippet": "",
        },
        "skills": {
            "count": 0,
            "list": [],
        },
        "gateway": {
            "telegram": False,
            "discord": False,
        }
    }

    # 1. SQLite state.db metrics
    if STATE_DB.exists():
        try:
            con = sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True)
            cur = con.cursor()
            cur.execute("""
                SELECT 
                    COUNT(*),
                    COALESCE(SUM(message_count), 0),
                    COALESCE(SUM(tool_call_count), 0),
                    COALESCE(SUM(input_tokens), 0),
                    COALESCE(SUM(output_tokens), 0),
                    COALESCE(SUM(cache_read_tokens), 0)
                FROM sessions
            """)
            row = cur.fetchone()
            if row:
                inp, out_tok, cache_r = row[3], row[4], row[5]
                denom = inp + cache_r
                cache_pct = round((cache_r / denom) * 100, 1) if denom > 0 else 0
                out["totals"] = {
                    "sessions": row[0],
                    "messages": row[1],
                    "tool_calls": row[2],
                    "input_tokens": inp,
                    "output_tokens": out_tok,
                    "cache_read_tokens": cache_r,
                    "cache_savings_pct": cache_pct,
                }

            cur.execute("""
                SELECT id, title, model, started_at, message_count, tool_call_count, input_tokens, output_tokens
                FROM sessions
                WHERE message_count > 0
                ORDER BY started_at DESC
                LIMIT 4
            """)
            recent = []
            for r in cur.fetchall():
                recent.append({
                    "id": r[0],
                    "title": r[1] or "Untitled Session",
                    "model": (r[2] or "").split("/")[-1] or "default",
                    "started_at": r[3],
                    "message_count": r[4] or 0,
                    "tool_call_count": r[5] or 0,
                    "input_tokens": r[6] or 0,
                    "output_tokens": r[7] or 0,
                })
            out["recent_sessions"] = recent
            con.close()
        except Exception:
            pass

    # 2. Memory files
    mem_file = HERMES_HOME / "memories" / "MEMORY.md"
    if mem_file.exists():
        try:
            txt = mem_file.read_text(encoding="utf-8", errors="ignore").strip()
            out["memory"]["used_chars"] = len(txt)
            first_line = txt.split("\n")[0].strip()
            out["memory"]["snippet"] = first_line[:140] + ("…" if len(first_line) > 140 else "")
        except Exception:
            pass

    # 3. Skills directory
    skills_dir = HERMES_HOME / "skills"
    if skills_dir.exists():
        try:
            skills = [p.name for p in skills_dir.iterdir() if (p.is_dir() or p.suffix in (".py", ".md")) and not p.name.startswith(".")]
            out["skills"]["count"] = len(skills)
            out["skills"]["list"] = skills[:8]
        except Exception:
            pass

    # 4. Gateway check
    gw_pid = HERMES_HOME / "gateway.pid"
    out["gateway"]["telegram"] = gw_pid.exists()

    return out


# --------------------------------------------------------------------------
# Update Checker & Updater
# --------------------------------------------------------------------------
UPDATE_CACHE: dict = {"ts": 0, "data": None}
GITHUB_REPO: str = "sufi96/hermes-settings-gui"

def check_updates(force: bool = False) -> dict:
    """Check GitHub repository for newer release tags or commits on main."""
    now = time.time()
    if not force and UPDATE_CACHE["data"] and (now - UPDATE_CACHE["ts"]) < 180:
        return UPDATE_CACHE["data"]

    repo_dir = str(Path(__file__).resolve().parent)
    current_commit = ""
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5, cwd=repo_dir)
        if r.returncode == 0:
            current_commit = r.stdout.strip()
    except Exception:
        pass

    latest_commit = ""
    commit_msg = ""
    commit_date = ""
    latest_tag = ""
    release_url = f"https://github.com/{GITHUB_REPO}"

    # 1. Fetch latest commit on main
    try:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{GITHUB_REPO}/commits/main",
            headers={"User-Agent": "Hermes-Settings-GUI", "Accept": "application/vnd.github.v3+json"}
        )
        with urllib.request.urlopen(req, timeout=8) as res:
            cdata = json.loads(res.read().decode("utf-8"))
            latest_commit = cdata.get("sha", "")
            commit_msg = cdata.get("commit", {}).get("message", "").split("\n")[0]
            commit_date = cdata.get("commit", {}).get("author", {}).get("date", "")
    except Exception as e:
        commit_msg = f"Check failed: {e}"

    # 2. Fetch latest tag
    try:
        treq = urllib.request.Request(
            f"https://api.github.com/repos/{GITHUB_REPO}/tags",
            headers={"User-Agent": "Hermes-Settings-GUI", "Accept": "application/vnd.github.v3+json"}
        )
        with urllib.request.urlopen(treq, timeout=8) as res:
            tdata = json.loads(res.read().decode("utf-8"))
            if tdata and isinstance(tdata, list):
                latest_tag = tdata[0].get("name", "")
                release_url = f"https://github.com/{GITHUB_REPO}/releases/tag/{latest_tag}"
    except Exception:
        pass

    # Compare version or commit
    has_update = False
    if latest_tag:
        raw_remote_ver = latest_tag.lstrip("v").strip()
        raw_local_ver = DECK_VERSION.lstrip("v").strip()
        if raw_remote_ver != raw_local_ver:
            try:
                r_parts = [int(x) for x in re.findall(r"\d+", raw_remote_ver)]
                l_parts = [int(x) for x in re.findall(r"\d+", raw_local_ver)]
                has_update = r_parts > l_parts
            except Exception:
                has_update = raw_remote_ver != raw_local_ver

    # If no tag difference, check if remote main commit differs from local HEAD
    if not has_update and current_commit and latest_commit and not current_commit.startswith(latest_commit[:10]):
        try:
            r = subprocess.run(
                ["git", "merge-base", "--is-ancestor", latest_commit, "HEAD"],
                cwd=repo_dir,
                capture_output=True,
                timeout=5
            )
            # If latest_commit is already an ancestor of HEAD, local is ahead or equal -> no update needed
            has_update = r.returncode != 0
        except Exception:
            has_update = True

    result = {
        "ok": True,
        "current_version": DECK_VERSION,
        "current_commit": current_commit[:7] if current_commit else "",
        "latest_version": latest_tag or (f"commit {latest_commit[:7]}" if latest_commit else ""),
        "latest_commit": latest_commit[:7] if latest_commit else "",
        "commit_message": commit_msg,
        "commit_date": commit_date,
        "has_update": bool(has_update),
        "release_url": release_url,
        "repo_url": f"https://github.com/{GITHUB_REPO}",
        "checked_at": now,
    }
    UPDATE_CACHE["ts"] = now
    UPDATE_CACHE["data"] = result
    return result


def apply_update() -> dict:
    """Run git pull origin main and schedule server restart."""
    repo_dir = str(Path(__file__).resolve().parent)
    try:
        r = subprocess.run(
            ["git", "pull", "origin", "main"],
            capture_output=True,
            text=True,
            timeout=40,
            cwd=repo_dir
        )
        if r.returncode == 0:
            out = r.stdout.strip()

            def _restart():
                time.sleep(1.2)
                try:
                    kwargs = {}
                    if os.name == "nt":
                        flags = 0
                        if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
                            flags |= subprocess.CREATE_NEW_PROCESS_GROUP
                        if hasattr(subprocess, "DETACHED_PROCESS"):
                            flags |= subprocess.DETACHED_PROCESS
                        if flags:
                            kwargs["creationflags"] = flags
                    subprocess.Popen([sys.executable] + sys.argv, cwd=repo_dir, **kwargs)
                    os._exit(0)
                except Exception:
                    pass

            threading.Thread(target=_restart, daemon=True).start()
            return {"ok": True, "output": out, "restarted": True}
        return {"ok": False, "message": (r.stderr or r.stdout or f"exit {r.returncode}").strip()}
    except Exception as e:
        return {"ok": False, "message": str(e)}


class Handler(BaseHTTPRequestHandler):
    server_version = f"HermesConfigDeck/{DECK_VERSION}"

    def log_message(self, fmt, *args):  # quieter console
        sys.stderr.write("· " + (fmt % args) + "\n")

    # -- plumbing ----------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str = "application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, code: int = 200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _authorized(self) -> bool:
        tok = self.headers.get("X-Config-Token") or ""
        if not tok:
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            tok = (q.get("token") or [""])[0]
        return secrets.compare_digest(tok, TOKEN)

    def _body(self) -> dict:
        try:
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n).decode("utf-8") or "{}")
        except Exception:
            return {}

    def _cli_result(self, result: dict):
        self._json(result, 200 if result["ok"] else 400)

    # -- routes ------------------------------------------------------------
    def do_GET(self):
        from urllib.parse import urlparse
        path = urlparse(self.path).path

        # UI shell (contains no secrets) — served WITHOUT a token so the
        # browser can load the css/js subresources. Every /api/* route
        # below still requires the token.
        if path in ("/", "/index.html"):
            self._serve_static("index.html")
            return
        if path == "/style.css":
            self._serve_static("style.css", "text/css; charset=utf-8")
            return
        if path == "/app.js":
            self._serve_static("app.js", "text/javascript; charset=utf-8")
            return
        if path in ("/favicon.ico", "/hermes_icon.ico", "/assets/hermes_icon.ico"):
            self._serve_static("hermes_icon.ico", "image/x-icon")
            return
        if path in ("/hermes_icon.png", "/assets/hermes_icon.png"):
            self._serve_static("hermes_icon.png", "image/png")
            return

        if not self._authorized():
            self._send(401, b'{"error": "bad or missing token"}')
            return

        if path == "/api/state":
            self._json(build_state())
        elif path == "/api/system/health":
            self._json(check_system_requirements())
        elif path == "/api/raw":
            try:
                self._json({"text": CONFIG_PATH.read_text(encoding="utf-8")})
            except Exception as e:
                self._json({"error": str(e)}, 400)
        elif path == "/api/env/reveal":
            key = self._qs().get("key", "").strip()
            if not re.fullmatch(r"[A-Za-z0-9_.]+", key):
                self._json({"error": "invalid key", "ok": False}, 400)
                return
            v = resolve_env_value(key)
            self._json({"value": v, "ok": True} if v is not None else {"error": "not set", "ok": False}, 200 if v is not None else 404)
        elif path == "/api/doctor":
            self._json(run_hermes("doctor", timeout=180))
        elif path == "/api/tools":
            platform = self._qs().get("platform", "cli")
            if not re.fullmatch(r"[a-z_0-9]+", platform):
                self._json({"ok": False, "message": "invalid platform"}, 400)
                return
            r = run_hermes("tools", "list", "--platform", platform, timeout=90)
            if r["ok"]:
                r = {**r, "tools": parse_tools_output(r["stdout"])}
            self._json(r)
        elif path == "/api/telegram/status":
            self._json(telegram_status())
        elif path == "/api/gateway/status":
            self._json(run_hermes("gateway", "status", timeout=30))
        elif path == "/api/gateway/logs":
            try:
                log_dir = HERMES_HOME / "logs"
                log_file = None
                for cand in ["gateway.log", "gateway-out.log", "gateway.err"]:
                    p = log_dir / cand
                    if p.exists():
                        log_file = p
                        break
                if not log_file:
                    # newest gateway-ish log
                    cands = sorted(log_dir.glob("*gateway*"), key=lambda x: x.stat().st_mtime)
                    log_file = cands[-1] if cands else None
                if not log_file:
                    self._json({"ok": False, "message": "No gateway log found in " + str(log_dir)})
                else:
                    text = log_file.read_text(encoding="utf-8", errors="replace")
                    self._json({"ok": True, "file": str(log_file),
                                "text": text[-8000:], "tail": "\n".join(text.splitlines()[-60:])})
            except Exception as e:
                self._json({"ok": False, "message": str(e)})
        elif path == "/api/mcp/list":
            self._json(run_hermes("mcp", "list", timeout=60))
        elif path == "/api/mcp/state":
            servers = (load_config().get("mcp_servers") or {})
            if not isinstance(servers, dict):
                servers = {}
            out = []
            for name, cfg in servers.items():
                if not isinstance(cfg, dict):
                    continue
                entry = {"name": name}
                if cfg.get("url"):
                    entry["transport"] = "http"
                    entry["url"] = cfg["url"]
                else:
                    entry["transport"] = "stdio"
                    entry["command"] = cfg.get("command", "")
                    entry["args"] = cfg.get("args", [])
                entry["env_keys"] = sorted((cfg.get("env") or {}).keys())
                out.append(entry)
            # catalog of one-click installs
            cat = run_hermes("mcp", "catalog", timeout=60)
            catalog = []
            if cat["ok"]:
                for line in cat["stdout"].splitlines():
                    m = re.match(r"\s{2}(\S+)\s{2,}(\S+)\s{2,}(.*)$", line)
                    if m and m.group(2) == "available":
                        catalog.append({"name": m.group(1), "desc": m.group(3).strip()})
            self._json({"ok": True, "servers": out, "catalog": catalog})
        elif path == "/api/chat/history":
            self._json(chat_history(self._qs().get("session", "")))
        elif path == "/api/chat/stats":
            self._json(chat_stats(self._qs().get("session", "")))
        elif path == "/api/backups":
            pats = ["hermes-backup-*.zip"]
            files = []
            for pat in pats:
                for p in sorted(Path.home().glob(pat), key=lambda x: x.stat().st_mtime, reverse=True):
                    files.append({"name": p.name, "path": str(p),
                                  "size_kb": round(p.stat().st_size / 1024), "mtime": p.stat().st_mtime})
            self._json({"backups": files[:20]})
        elif path == "/api/update/check":
            force = self._qs().get("force", "") == "1"
            self._json(check_updates(force=force))
        elif path == "/api/dashboard/overview":
            self._json(dashboard_overview())
        else:
            self._send(404, b'{"error": "not found"}')

    def do_POST(self):
        from urllib.parse import urlparse
        path = urlparse(self.path).path

        if not self._authorized():
            self._send(401, b'{"error": "bad or missing token"}')
            return
        body = self._body()

        try:
            if path == "/api/set":
                key, value = str(body.get("key", "")), body.get("value")
                if not key:
                    raise ValueError("missing key")
                # structured values (lists/dicts/numbers/bools) arrive typed;
                # strings must be passed through as single CLI args.
                if isinstance(value, (dict, list)):
                    sval = json.dumps(value, separators=(",", ":"))
                else:
                    sval = "" if value is None else str(value)
                if sval == "":
                    self._cli_result(run_hermes("config", "unset", key))
                elif re.fullmatch(r"[A-Za-z0-9_.\-]+", key):
                    self._cli_result(run_hermes("config", "set", key, sval))
                else:
                    raise ValueError("invalid key format")
            elif path == "/api/config/set":
                section = str(body.get("section", "")).strip()
                values = body.get("values", {})
                if not section or not isinstance(values, dict):
                    raise ValueError("section must be a string and values must be a dictionary")
                last_res = {"ok": True}
                for k, v in values.items():
                    full_key = f"{section}.{k}"
                    if v is None or v == "":
                        res = run_hermes("config", "unset", full_key)
                    else:
                        sval = json.dumps(v, separators=(",", ":")) if isinstance(v, (dict, list)) else str(v)
                        res = run_hermes("config", "set", full_key, sval)
                    if not res.get("ok"):
                        self._cli_result(res)
                        return
                    last_res = res
                self._cli_result(last_res)
            elif path == "/api/unset":
                key = str(body.get("key", ""))
                if not re.fullmatch(r"[A-Za-z0-9_.\-]+", key):
                    raise ValueError("invalid key format")
                self._cli_result(run_hermes("config", "unset", key))
            elif path == "/api/tools":
                action = body.get("action")  # enable | disable
                name = str(body.get("name", ""))
                platform = str(body.get("platform", "cli"))
                if action not in ("enable", "disable") or not name:
                    raise ValueError("bad tools request")
                self._cli_result(run_hermes("tools", action, name, "--platform", platform, timeout=90))
            elif path == "/api/fallback":
                entries = body.get("entries", [])
                clean = []
                for e in entries:
                    if isinstance(e, dict) and e.get("provider") and e.get("model"):
                        ent = {"provider": str(e["provider"]), "model": str(e["model"])}
                        if e.get("base_url"):
                            ent["base_url"] = str(e["base_url"])
                        clean.append(ent)
                if clean:
                    sval = json.dumps(clean, separators=(",", ":"))
                    self._cli_result(run_hermes("config", "set", "fallback_providers", sval))
                else:
                    self._cli_result(run_hermes("config", "unset", "fallback_providers"))
            elif path == "/api/providers":
                providers = body.get("providers", [])
                if not isinstance(providers, list):
                    raise ValueError("providers must be a list")
                self._cli_result(run_hermes(
                    "config", "set", "custom_providers",
                    json.dumps(providers, separators=(",", ":")), timeout=90))
            elif path == "/api/env/set":
                key, value = str(body.get("key", "")), str(body.get("value", ""))
                if not re.fullmatch(r"[A-Za-z0-9_]+", key) or not key.isupper():
                    raise ValueError("env keys must be UPPER_SNAKE_CASE")
                self._cli_result(run_hermes("config", "set", key, value))
            elif path == "/api/env/reveal":
                key = str(body.get("key", "")).strip() or self._qs().get("key", "").strip()
                if not re.fullmatch(r"[A-Za-z0-9_.]+", key):
                    self._json({"error": "invalid key", "ok": False}, 400)
                    return
                v = resolve_env_value(key)
                self._json({"value": v, "ok": True} if v is not None else {"error": "not set", "ok": False}, 200 if v is not None else 404)
            elif path == "/api/env/delete":
                key = str(body.get("key", ""))
                if not re.fullmatch(r"[A-Za-z0-9_]+", key):
                    raise ValueError("invalid key")
                self._cli_result(run_hermes("config", "unset", key))
            elif path == "/api/probe/models":
                base_url = str(body.get("base_url", "")).strip()
                api_key = body.get("api_key") or api_key_for(base_url, None)
                if not base_url.startswith(("http://", "https://")):
                    raise ValueError("base_url must start with http(s)://")
                models = probe_models(base_url, api_key)
                self._json({"ok": True, "models": models, "count": len(models)})
            elif path == "/api/probe/chat":
                base_url = str(body.get("base_url", "")).strip()
                model = str(body.get("model", "")).strip()
                api_key = body.get("api_key") or api_key_for(base_url, None)
                if not (base_url.startswith(("http://", "https://")) and model):
                    raise ValueError("need base_url and model")
                self._json({"ok": True, "result": probe_chat(base_url, api_key, model)})
            elif path == "/api/probe/provider":
                provider = str(body.get("provider", "")).strip()
                base_url = str(body.get("base_url", "")).strip()
                model = str(body.get("model", "")).strip()
                test_chat = bool(body.get("test_chat"))

                target = resolve_provider_target(provider, base_url)
                if target is None:
                    self._json({"ok": False, "message":
                                f"Unknown provider '{provider or '(empty)'}'. For custom websites, "
                                "add it on the Custom Providers page first, or fill the base URL."}, 400)
                    return
                if target.get("oauth"):
                    self._json({"ok": False, "message": target["message"]}, 400)
                    return

                base = target["base_url"]
                if not base.startswith(("http://", "https://")):
                    self._json({"ok": False, "message": f"Invalid address: {base}"}, 400)
                    return

                # resolve the API key: explicit env var first, then candidates
                key = None
                key_env = target.get("key_env")
                if key_env:
                    key = resolve_env_value(key_env)
                if not key:
                    for cand in target.get("key_candidates") or []:
                        key = resolve_env_value(cand)
                        if key:
                            key_env = key_env or cand
                            break
                key_needed = target.get("key_needed", True)
                key_found = bool(key)
                # name the exact env var the user should set, even if the
                # server rejected us before we could mention it
                key_hint = key_env or (
                    (target.get("key_candidates") or [None])[0] if key_needed else None) or "API key"

                if not test_chat:
                    try:
                        models = probe_models(base, key, headers=target.get("headers"),
                                              x_api_key=target.get("x_api_key", False))
                        self._json({"ok": True, "models": models, "count": len(models),
                                    "key_needed": key_needed, "key_found": key_found,
                                    "key_env": key_hint, "base_url": base})
                    except RuntimeError as e:
                        msg = str(e)
                        if key_needed and not key_found:
                            msg += (f" — no {key_hint} found in .env. "
                                    "Add it on the API Keys page and try again.")
                        self._json({"ok": False, "message": msg,
                                    "key_needed": key_needed, "key_found": key_found,
                                    "key_env": key_hint}, 502)
                else:
                    if not model:
                        self._json({"ok": False, "message": "Type or pick a model first."}, 400)
                        return
                    try:
                        result = probe_chat(base, key, model,
                                           headers=target.get("headers"),
                                           x_api_key=target.get("x_api_key", False))
                        self._json({"ok": True, "chat_ok": True, "chat": result,
                                    "key_found": key_found, "key_env": key_hint})
                    except RuntimeError as e:
                        msg = str(e)
                        if key_needed and not key_found:
                            msg += f" — no {key_hint} in .env."
                        self._json({"ok": False, "message": msg,
                                    "key_needed": key_needed, "key_found": key_found,
                                    "key_env": key_hint}, 502)
            elif path == "/api/probe/speed":
                provider = str(body.get("provider", "")).strip()
                base_url = str(body.get("base_url", "")).strip()
                model = str(body.get("model", "")).strip()
                test_type = str(body.get("test_type", "standard")).strip()
                custom_prompt = str(body.get("custom_prompt", "")).strip()

                if not model:
                    self._json({"ok": False, "message": "Type or pick a model first."}, 400)
                    return

                target = resolve_provider_target(provider, base_url)
                if target is None:
                    self._json({"ok": False, "message":
                                f"Unknown provider '{provider or '(empty)'}'. For custom websites, "
                                "add it on the Custom Providers page first, or fill the base URL."}, 400)
                    return
                if target.get("oauth"):
                    self._json({"ok": False, "message": target["message"]}, 400)
                    return

                base = target["base_url"]
                if not base.startswith(("http://", "https://")):
                    self._json({"ok": False, "message": f"Invalid address: {base}"}, 400)
                    return

                key = None
                key_env = target.get("key_env")
                if key_env:
                    key = resolve_env_value(key_env)
                if not key:
                    for cand in target.get("key_candidates") or []:
                        key = resolve_env_value(cand)
                        if key:
                            key_env = key_env or cand
                            break
                key_needed = target.get("key_needed", True)
                key_found = bool(key)
                key_hint = key_env or (
                    (target.get("key_candidates") or [None])[0] if key_needed else None) or "API key"

                try:
                    result = probe_speed(
                        base, key, model,
                        test_type=test_type,
                        custom_prompt=custom_prompt,
                        headers=target.get("headers"),
                        x_api_key=target.get("x_api_key", False)
                    )
                    result["key_found"] = key_found
                    result["key_env"] = key_hint
                    result["provider"] = provider
                    result["base_url"] = base
                    self._json(result)
                except RuntimeError as e:
                    msg = str(e)
                    if key_needed and not key_found:
                        msg += f" — no {key_hint} in .env. If this provider needs a key, add it on the API Keys page."
                    self._json({"ok": False, "message": msg,
                                "key_needed": key_needed, "key_found": key_found,
                                "key_env": key_hint}, 502)
            elif path == "/api/telegram/save":
                token = str(body.get("token", "")).strip()
                users = str(body.get("allowed_users", "")).strip()
                home = str(body.get("home_channel", "")).strip()
                results = []
                if token:
                    r = env_write("TELEGRAM_BOT_TOKEN", token)
                    results.append(("TELEGRAM_BOT_TOKEN", r))
                if users:
                    r = env_write("TELEGRAM_ALLOWED_USERS", users.replace(" ", ""))
                    results.append(("TELEGRAM_ALLOWED_USERS", r))
                if home:
                    r = env_write("TELEGRAM_HOME_CHANNEL", home)
                    results.append(("TELEGRAM_HOME_CHANNEL", r))
                failed = [f"{k}: {v['message']}" for k, v in results if not v["ok"]]
                self._json({"ok": not failed,
                            "message": ("Saved: " + ", ".join(k for k, _ in results)) if results and not failed
                                       else ("; ".join(failed) if failed else "nothing to save"),
                            "saved_keys": [k for k, _ in results]}, 200 if not failed else 500)
            elif path == "/api/telegram/verify":
                # call Telegram getMe with the saved token — real proof the bot exists
                token = str(body.get("token", "")).strip() or resolve_env_value("TELEGRAM_BOT_TOKEN")
                if not token:
                    self._json({"ok": False, "message": "No token saved yet — paste your token from @BotFather first."}, 400)
                    return
                try:
                    data = http_json(f"https://api.telegram.org/bot{token}/getMe", None, timeout=15)
                    if data.get("ok"):
                        b = data.get("result", {})
                        self._json({"ok": True, "bot_username": b.get("username", ""),
                                    "bot_name": b.get("first_name", "")})
                    else:
                        self._json({"ok": False,
                                    "message": "Telegram rejected this token: " + str(data.get("description", "unknown"))}, 502)
                except RuntimeError as e:
                    self._json({"ok": False, "message": str(e)}, 502)
            elif path == "/api/gateway/start":
                # refuse to start a second INSTANCE (two pollers fight over the
                # bot). One instance = launcher+worker python pair, which is normal.
                instances = gateway_instances()
                if len(instances) > 1:
                    self._json({"ok": False,
                                "message": f"{len(instances)} gateway instances are already running "
                                           f"({', '.join(', '.join(map(str, i)) for i in instances)}). "
                                           "Two instances fight over your bot and Telegram drops "
                                           "messages. Use 'Stop all duplicates' first, then Start."},
                                409)
                    return
                r = run_hermes("gateway", "start", timeout=120)
                self._json(r)
            elif path == "/api/gateway/stop":
                self._json(run_hermes("gateway", "stop", timeout=90))
            elif path == "/api/gateway/killdupes":
                # kill ALL gateway processes; the next Start brings up exactly one
                pids = gateway_pids()
                killed, failed = [], []
                for pid in pids:
                    try:
                        if os.name == "nt":
                            sp = subprocess.run(["taskkill", "/F", "/PID", str(pid)],
                                                 capture_output=True, text=True, timeout=30)
                        else:
                            sp = subprocess.run(["kill", "-9", str(pid)],
                                                 capture_output=True, text=True, timeout=30)
                        (killed if sp.returncode == 0 else failed).append(pid)
                    except Exception:
                        failed.append(pid)
                self._json({"ok": not failed,
                            "message": (f"Killed {len(killed)} duplicate gateway process(es): {killed}. "
                                        "Now press Start gateway to bring up exactly one.")
                                       if killed else "No gateway processes found.",
                            "killed": killed, "failed": failed})
            elif path == "/api/mcp/save":
                # full mcp_servers dict write via config set (verified path)
                servers = body.get("servers", {})
                if not isinstance(servers, dict):
                    self._json({"ok": False, "message": "servers must be a mapping"}, 400)
                    return
                clean = {}
                for name, cfg in servers.items():
                    if not re.fullmatch(r"[A-Za-z0-9_\-]+", str(name)):
                        self._json({"ok": False, "message": f"invalid server name: {name!r}"}, 400)
                        return
                    cfg = cfg or {}
                    if cfg.get("url"):
                        clean[name] = {"url": str(cfg["url"])}
                        if cfg.get("headers"):
                            clean[name]["headers"] = {str(k): str(v) for k, v in cfg["headers"].items()}
                    elif cfg.get("command"):
                        clean[name] = {"command": str(cfg["command"]),
                                       "args": [str(a) for a in (cfg.get("args") or [])]}
                        if cfg.get("env"):
                            clean[name]["env"] = {str(k): str(v) for k, v in cfg["env"].items()}
                    else:
                        self._json({"ok": False, "message":
                                    f"'{name}' needs either a URL (for online servers) or a command (for local ones)"}, 400)
                        return
                if not clean:
                    # empty mapping → remove the key entirely (CLI refuses scalar {})
                    self._cli_result(run_hermes("config", "unset", "mcp_servers", timeout=60))
                    return
                self._cli_result(run_hermes(
                    "config", "set", "mcp_servers",
                    json.dumps(clean, separators=(",", ":")), timeout=60))
            elif path == "/api/mcp/test":
                name = str(body.get("name", ""))
                if not re.fullmatch(r"[A-Za-z0-9_\-]+", name):
                    self._json({"ok": False, "message": "invalid name"}, 400)
                    return
                self._json(run_hermes("mcp", "test", name, timeout=120))
            elif path == "/api/mcp/install":
                name = str(body.get("name", ""))
                if not re.fullmatch(r"[a-z0-9_\-]+", name):
                    self._json({"ok": False, "message": "invalid catalog name"}, 400)
                    return
                self._json(run_hermes("mcp", "install", name, timeout=180))
            elif path == "/api/chat/send":
                message = str(body.get("message", ""))
                resume = str(body.get("session_id", "") or "") or None
                if resume and not re.fullmatch(r"[A-Za-z0-9_\-]+", resume):
                    self._json({"ok": False, "message": "invalid session id"}, 400)
                    return
                if not message.strip():
                    self._json({"ok": False, "message": "empty message"}, 400)
                    return
                self._json(chat_send(message, resume))
            elif path == "/api/chat/compress":
                resume = str(body.get("session_id", "") or "") or None
                args = str(body.get("args", "") or "")
                if not resume:
                    resume = CHAT_STATE.get("session_id")
                self._json(chat_compress(resume, args))
            elif path == "/api/chat/new":
                CHAT_STATE["session_id"] = None
                self._json({"ok": True})
            elif path == "/api/update/apply":
                self._json(apply_update())
            elif path == "/api/backup":
                self._json(run_hermes("backup", timeout=300))
            else:
                self._send(404, b'{"error": "not found"}')
        except ValueError as e:
            self._json({"ok": False, "message": str(e)}, 400)
        except RuntimeError as e:
            self._json({"ok": False, "message": str(e)}, 502)

    # -- static ------------------------------------------------------------
    def _qs(self):
        from urllib.parse import urlparse, parse_qs
        return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

    def _serve_static(self, name: str, ctype: str = "text/html; charset=utf-8"):
        for base in (STATIC_DIR, ASSETS_DIR, Path(__file__).resolve().parent):
            p = base / name
            if p.exists() and p.is_file():
                self._send(200, p.read_bytes(), ctype)
                return
        self._send(404, b"missing", "text/plain")


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main():
    global HERMES_EXE
    ap = argparse.ArgumentParser(description="Hermes config web GUI")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    HERMES_EXE = find_hermes_exe()
    reqs = check_system_requirements()

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://127.0.0.1:{args.port}/?token={TOKEN}"
    print()
    print("  ================================================================")
    print(f"         Hermes Agent — Config Deck v{DECK_VERSION} (Local Web UI)")
    print("  ================================================================")
    print("  System Pre-Flight Check:")
    for ch in reqs["checks"]:
        mark = "[OK]" if ch["ok"] else ("[WARN]" if ch["status"] == "warn" else "[MISSING]")
        print(f"    {mark:<9} {ch['name']:<28}: {ch['title']}")
        if not ch["ok"]:
            print(f"              -> Detail: {ch['detail']}")
            print(f"              -> Action: {ch['help']}")
    print("  ----------------------------------------------------------------")
    if not reqs["hermes_installed"]:
        print("  [!] NOTICE: Hermes Agent CLI is NOT detected on this machine.")
        print("      The web UI is running in portable setup mode.")
        print("      You can configure keys, models, and restore backups.")
    elif not reqs["all_met"]:
        print("  [!] Some components need attention. See checks above.")
    else:
        print("  [OK] All system requirements met. Agent engine is ready.")
    print("  ----------------------------------------------------------------")
    print(f"  Web Interface URL : {url}")
    print("  (Bound to 127.0.0.1 — token-authenticated session)")
    print("  ================================================================")
    print()

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  bye — config deck closed.")


if __name__ == "__main__":
    main()
