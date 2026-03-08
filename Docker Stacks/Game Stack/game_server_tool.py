"""
title: Game Server Control
author: Atlas AI
version: 2.0
description: Manage game servers via Pterodactyl Panel — list, start/stop, diagnose crashes, send commands, view logs, presets
"""

import requests
import json
import os
from pydantic import BaseModel, Field
from typing import Optional


class Valves(BaseModel):
    PANEL_URL: str = Field(
        default="http://pterodactyl-panel:80",
        description="Pterodactyl Panel internal URL",
    )
    APP_API_KEY: str = Field(
        default="bGXP40rS3g5FJdaTbkiP2WnB5of3HN3NBMmT9fZL5vTA65zvgRBRRTzs1lPgO0kg",
        description="Application API key (admin ops — create servers, manage allocations)",
    )
    CLIENT_API_KEY: str = Field(
        default="h9xX34wBLNWuIna0Z71P1XrZowPOsXvyoPWKEHDx2LpjMmbM7IPg7tdmG5hQQkX4",
        description="Client API key (user ops — power, console, logs, files)",
    )
    WINGS_URL: str = Field(
        default="http://pterodactyl-wings:443",
        description="Wings daemon internal URL (for direct server queries)",
    )
    WINGS_TOKEN: str = Field(
        default="i4Vg4xau8NuojVuYfdfApYtibyIHVXrBnomu2pL2sAmoEdn16cE5NxSfXqNHNmfI",
        description="Wings node token (from config.yml)",
    )
    PRESETS_PATH: str = Field(
        default="/app/backend/data/presets.json",
        description="Path to server presets config file",
    )
    GAME_DOMAIN: str = Field(
        default="lonebeast.net",
        description="Base domain for game server connections (e.g. mc.lonebeast.net)",
    )
    REQUEST_TIMEOUT: int = Field(
        default=15,
        description="HTTP request timeout in seconds",
    )


# ── Module-level helpers (not part of Tools class = invisible to Open WebUI) ──


def _app_headers(valves):
    return {
        "Authorization": f"Bearer {valves.APP_API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _client_headers(valves):
    return {
        "Authorization": f"Bearer {valves.CLIENT_API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _wings_headers(valves):
    return {
        "Authorization": f"Bearer {valves.WINGS_TOKEN}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


def _get(url, headers, timeout):
    r = requests.get(url, headers=headers, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _post(url, headers, data=None, timeout=15):
    r = requests.post(url, headers=headers, json=data, timeout=timeout)
    r.raise_for_status()
    return r


def _resolve_server(valves, server_ref: str) -> str:
    """Resolve a server name or partial ID to its short identifier."""
    try:
        data = _get(
            f"{valves.PANEL_URL}/api/client",
            _client_headers(valves),
            valves.REQUEST_TIMEOUT,
        )
        for s in data.get("data", []):
            a = s["attributes"]
            if (
                a["identifier"] == server_ref
                or a["name"].lower() == server_ref.lower()
                or a["uuid"].startswith(server_ref)
                or server_ref.lower() in a["name"].lower()
            ):
                return a["identifier"]
    except Exception:
        pass
    return server_ref


def _get_uuid(valves, identifier: str) -> str:
    """Get full UUID from short identifier."""
    try:
        data = _get(
            f"{valves.PANEL_URL}/api/client/servers/{identifier}",
            _client_headers(valves),
            valves.REQUEST_TIMEOUT,
        )
        return data["attributes"]["uuid"]
    except Exception:
        return identifier


def _find_egg(valves, game_name: str):
    """Find an egg by name, returns (egg_id, nest_id, egg_data) or (None, None, None)."""
    try:
        data = _get(
            f"{valves.PANEL_URL}/api/application/nests?include=eggs",
            _app_headers(valves),
            valves.REQUEST_TIMEOUT,
        )
        for nest in data.get("data", []):
            nest_id = nest["attributes"]["id"]
            for egg in (
                nest["attributes"]
                .get("relationships", {})
                .get("eggs", {})
                .get("data", [])
            ):
                ea = egg["attributes"]
                if ea["name"].lower() == game_name.lower() or game_name.lower() in ea["name"].lower():
                    return ea["id"], nest_id, ea
    except Exception:
        pass
    return None, None, None


def _find_free_allocation(valves):
    """Find the first unassigned allocation. Returns (alloc_id, port) or (None, None)."""
    try:
        data = _get(
            f"{valves.PANEL_URL}/api/application/nodes/1/allocations",
            _app_headers(valves),
            valves.REQUEST_TIMEOUT,
        )
        for a in data.get("data", []):
            if not a["attributes"].get("assigned"):
                return a["attributes"]["id"], a["attributes"].get("port")
    except Exception:
        pass
    return None, None


def _load_presets(valves) -> dict:
    """Load presets from JSON file."""
    try:
        with open(valves.PRESETS_PATH, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def _resolve_preset(valves, game_query: str):
    """Resolve a game query to a preset. Returns (game_key, preset_key, preset_data) or (None, None, None)."""
    presets = _load_presets(valves)
    query = game_query.lower().strip()

    # Direct preset key match (e.g. "atm10", "pure_vanilla")
    for game_key, game_presets in presets.items():
        if query in game_presets:
            return game_key, query, game_presets[query]

    # Tag match — collect all matches
    matches = []
    for game_key, game_presets in presets.items():
        for preset_key, preset_data in game_presets.items():
            tags = [t.lower() for t in preset_data.get("tags", [])]
            label = preset_data.get("label", "").lower()
            if query in tags or query == label or query in label:
                matches.append((game_key, preset_key, preset_data))

    if len(matches) == 1:
        return matches[0]

    return None, None, None


# ── Tools class (only public methods here = visible to Open WebUI) ──


class Tools:
    def __init__(self):
        self.valves = Valves()

    # ── Tool 1: List Servers ──────────────────────────────

    def list_servers(self) -> str:
        """
        List all game servers with their current status, game type, and resource usage.

        Use this when the user asks what servers exist, wants to see server status,
        or says something like "what game servers are running?"
        """
        try:
            data = _get(
                f"{self.valves.PANEL_URL}/api/client",
                _client_headers(self.valves),
                self.valves.REQUEST_TIMEOUT,
            )
            servers = data.get("data", [])
            if not servers:
                return "No game servers found."

            lines = []
            for s in servers:
                a = s["attributes"]
                identifier = a["identifier"]
                name = a["name"]
                desc = a.get("description", "")

                try:
                    res = _get(
                        f"{self.valves.WINGS_URL}/api/servers/{a['uuid']}",
                        _wings_headers(self.valves),
                        self.valves.REQUEST_TIMEOUT,
                    )
                    state = res.get("state", "unknown")
                    util = res.get("utilization", {})
                    mem_mb = util.get("memory_bytes", 0) / 1024 / 1024
                    cpu = util.get("cpu_absolute", 0)
                    uptime_s = util.get("uptime", 0) / 1000
                except Exception:
                    state = "unknown"
                    mem_mb = 0
                    cpu = 0
                    uptime_s = 0

                line = f"• {name} [{identifier}] — {state}"
                if state == "running":
                    line += f" | CPU: {cpu:.1f}% | RAM: {mem_mb:.0f}MB | Uptime: {uptime_s:.0f}s"
                if desc:
                    line += f"\n  {desc}"
                lines.append(line)

            return f"Game Servers ({len(servers)}):\n\n" + "\n".join(lines)
        except Exception as e:
            return f"Error listing servers: {e}"

    # ── Tool 2: Server Power ─────────────────────────────

    def server_power(
        self,
        server: str = Field(
            ...,
            description="Server name or short identifier (e.g. 'MC-Test-Paper' or 'bdd9644d')",
        ),
        action: str = Field(
            ...,
            description="Power action to perform",
            enum=["start", "stop", "restart", "kill"],
        ),
    ) -> str:
        """
        Start, stop, restart, or kill a game server.

        Use this when the user says "start the minecraft server", "restart valheim",
        "stop the game server", etc.
        """
        try:
            identifier = _resolve_server(self.valves, server)
            _post(
                f"{self.valves.PANEL_URL}/api/client/servers/{identifier}/power",
                _client_headers(self.valves),
                {"signal": action},
                self.valves.REQUEST_TIMEOUT,
            )
            return f"Power action '{action}' sent to server '{server}'. The server is now processing the request."
        except Exception as e:
            return f"Error sending power action: {e}"

    # ── Tool 3: Server Status ────────────────────────────

    def server_status(
        self,
        server: str = Field(
            ...,
            description="Server name or short identifier",
        ),
    ) -> str:
        """
        Get detailed status of a specific game server including CPU, memory,
        disk usage, network stats, and uptime.

        Use this when the user asks "how is the minecraft server doing?",
        "is the server lagging?", or wants performance details.
        """
        try:
            identifier = _resolve_server(self.valves, server)
            details = _get(
                f"{self.valves.PANEL_URL}/api/client/servers/{identifier}",
                _client_headers(self.valves),
                self.valves.REQUEST_TIMEOUT,
            )
            attrs = details["attributes"]
            limits = attrs.get("limits", {})

            uuid = attrs["uuid"]
            res = _get(
                f"{self.valves.WINGS_URL}/api/servers/{uuid}",
                _wings_headers(self.valves),
                self.valves.REQUEST_TIMEOUT,
            )
            state = res.get("state", "unknown")
            util = res.get("utilization", {})

            mem_mb = util.get("memory_bytes", 0) / 1024 / 1024
            mem_limit = util.get("memory_limit_bytes", 0) / 1024 / 1024
            cpu = util.get("cpu_absolute", 0)
            disk_mb = util.get("disk_bytes", 0) / 1024 / 1024
            net_rx = util.get("network", {}).get("rx_bytes", 0) / 1024
            net_tx = util.get("network", {}).get("tx_bytes", 0) / 1024
            uptime_s = util.get("uptime", 0) / 1000

            uptime_str = "0s"
            if uptime_s > 0:
                hours = int(uptime_s // 3600)
                mins = int((uptime_s % 3600) // 60)
                secs = int(uptime_s % 60)
                parts = []
                if hours:
                    parts.append(f"{hours}h")
                if mins:
                    parts.append(f"{mins}m")
                parts.append(f"{secs}s")
                uptime_str = " ".join(parts)

            return (
                f"Server: {attrs['name']}\n"
                f"State: {state}\n"
                f"Uptime: {uptime_str}\n"
                f"CPU: {cpu:.1f}% (limit: {limits.get('cpu', 'N/A')}%)\n"
                f"Memory: {mem_mb:.0f}MB / {mem_limit:.0f}MB (limit: {limits.get('memory', 'N/A')}MB)\n"
                f"Disk: {disk_mb:.0f}MB (limit: {limits.get('disk', 'N/A')}MB)\n"
                f"Network: {net_rx:.1f}KB rx / {net_tx:.1f}KB tx\n"
                f"Node: {attrs.get('node', 'Unknown')}"
            )
        except Exception as e:
            return f"Error getting server status: {e}"

    # ── Tool 4: Send Console Command ─────────────────────

    def send_command(
        self,
        server: str = Field(
            ..., description="Server name or short identifier"
        ),
        command: str = Field(
            ...,
            description="Console command to send (e.g. '/whitelist add Steve', '/save-all', 'say Hello')",
        ),
    ) -> str:
        """
        Send a console command to a running game server.

        Use this when the user says "whitelist me on minecraft", "save the server",
        "run /list on the server", "say hello on the server", etc.
        Commands are sent exactly as provided (without leading slash for most games).
        """
        try:
            identifier = _resolve_server(self.valves, server)
            cmd = command.lstrip("/")
            _post(
                f"{self.valves.PANEL_URL}/api/client/servers/{identifier}/command",
                _client_headers(self.valves),
                {"command": cmd},
                self.valves.REQUEST_TIMEOUT,
            )
            return f"Command sent to server: `{cmd}`"
        except requests.exceptions.HTTPError as e:
            if e.response and e.response.status_code == 502:
                return "Error: Server is not running. Start it first before sending commands."
            return f"Error sending command: {e}"
        except Exception as e:
            return f"Error sending command: {e}"

    # ── Tool 5: Server Logs ──────────────────────────────

    def server_logs(
        self,
        server: str = Field(
            ..., description="Server name or short identifier"
        ),
        lines: int = Field(
            default=50,
            description="Number of log lines to retrieve (default 50, max 200)",
        ),
    ) -> str:
        """
        Fetch recent console logs from a game server.

        Use this when the user reports a crash, asks "what happened?",
        wants to check for errors, or needs to see server output.
        The logs are returned raw — analyze them for errors, warnings,
        crash patterns, and provide diagnosis.
        """
        try:
            identifier = _resolve_server(self.valves, server)
            lines = min(lines, 200)

            data = _get(
                f"{self.valves.PANEL_URL}/api/client/servers/{identifier}/resources",
                _client_headers(self.valves),
                self.valves.REQUEST_TIMEOUT,
            )
            state = data.get("attributes", {}).get("current_state", "unknown")

            uuid = _get_uuid(self.valves, identifier)
            try:
                r = requests.get(
                    f"{self.valves.WINGS_URL}/api/servers/{uuid}/logs",
                    headers=_wings_headers(self.valves),
                    params={"size": lines},
                    timeout=self.valves.REQUEST_TIMEOUT,
                )
                if r.status_code == 200:
                    log_data = r.json()
                    if isinstance(log_data, list):
                        log_text = "\n".join(log_data)
                    elif isinstance(log_data, dict):
                        log_text = log_data.get("data", str(log_data))
                    else:
                        log_text = str(log_data)
                else:
                    log_text = f"(Could not fetch logs: HTTP {r.status_code})"
            except Exception:
                log_text = "(Could not fetch logs from Wings)"

            return (
                f"Server State: {state}\n"
                f"Last {lines} log lines:\n\n{log_text}\n\n"
                "---\n"
                "Analyze the above logs. Look for: ERROR, Exception, FATAL, OutOfMemory, "
                "crash, timeout, connection refused, mod conflicts, missing files. "
                "Provide diagnosis and suggested fixes."
            )
        except Exception as e:
            return f"Error fetching logs: {e}"

    # ── Tool 6: Diagnose Server ──────────────────────────

    def diagnose_server(
        self,
        server: str = Field(
            ..., description="Server name or short identifier"
        ),
    ) -> str:
        """
        Diagnose issues with a game server by pulling logs and status.

        Use this when the user says "the server crashed", "why won't it start?",
        "something is wrong with the server", or any troubleshooting scenario.
        Returns logs + status data for you to analyze and explain.
        """
        try:
            identifier = _resolve_server(self.valves, server)
            uuid = _get_uuid(self.valves, identifier)

            details = _get(
                f"{self.valves.PANEL_URL}/api/client/servers/{identifier}",
                _client_headers(self.valves),
                self.valves.REQUEST_TIMEOUT,
            )
            attrs = details["attributes"]
            limits = attrs.get("limits", {})

            try:
                res = _get(
                    f"{self.valves.WINGS_URL}/api/servers/{uuid}",
                    _wings_headers(self.valves),
                    self.valves.REQUEST_TIMEOUT,
                )
                state = res.get("state", "unknown")
                util = res.get("utilization", {})
                mem_mb = util.get("memory_bytes", 0) / 1024 / 1024
                mem_limit = util.get("memory_limit_bytes", 0) / 1024 / 1024
            except Exception:
                state = "unknown"
                mem_mb = 0
                mem_limit = 0

            try:
                r = requests.get(
                    f"{self.valves.WINGS_URL}/api/servers/{uuid}/logs",
                    headers=_wings_headers(self.valves),
                    params={"size": 100},
                    timeout=self.valves.REQUEST_TIMEOUT,
                )
                if r.status_code == 200:
                    log_data = r.json()
                    if isinstance(log_data, list):
                        log_text = "\n".join(log_data)
                    else:
                        log_text = str(log_data)
                else:
                    log_text = "(Logs unavailable)"
            except Exception:
                log_text = "(Logs unavailable)"

            return (
                f"=== DIAGNOSIS REPORT ===\n"
                f"Server: {attrs['name']} ({identifier})\n"
                f"State: {state}\n"
                f"Memory: {mem_mb:.0f}MB / {mem_limit:.0f}MB (limit: {limits.get('memory', '?')}MB)\n"
                f"CPU Limit: {limits.get('cpu', '?')}%\n"
                f"Disk Limit: {limits.get('disk', '?')}MB\n\n"
                f"=== RECENT LOGS ===\n{log_text}\n\n"
                "=== ANALYZE ===\n"
                "Based on the state and logs above, diagnose the issue. Common patterns:\n"
                "- OOM: 'OutOfMemoryError' or killed by cgroup → needs more RAM\n"
                "- Crash loop: server starts then immediately stops → check startup command or mods\n"
                "- Mod conflict: 'DuplicateModsFoundException' or 'MixinApplyError' → identify conflicting mod\n"
                "- Port conflict: 'Address already in use' → check allocation\n"
                "- EULA: 'agree to the EULA' → accept eula.txt\n"
                "- Missing files: 'Unable to access jarfile' → needs reinstall\n"
                "- Watchdog: 'Can't keep up!' or tick timeout → reduce view distance or player count\n"
                "Explain what happened in plain language and suggest a fix."
            )
        except Exception as e:
            return f"Error diagnosing server: {e}"

    # ── Tool 7: Backup Server ────────────────────────────

    def backup_server(
        self,
        server: str = Field(
            ..., description="Server name or short identifier"
        ),
    ) -> str:
        """
        Create a backup of a game server.

        Use this when the user wants to backup before making changes,
        or asks to save the server state.
        """
        try:
            identifier = _resolve_server(self.valves, server)
            r = _post(
                f"{self.valves.PANEL_URL}/api/client/servers/{identifier}/backups",
                _client_headers(self.valves),
                timeout=self.valves.REQUEST_TIMEOUT,
            )
            data = r.json()
            backup = data.get("attributes", {})
            return (
                f"Backup initiated for server '{server}'.\n"
                f"Backup UUID: {backup.get('uuid', 'unknown')}\n"
                f"Name: {backup.get('name', 'auto-backup')}\n"
                f"Status: {backup.get('completed_at') or 'in progress'}"
            )
        except Exception as e:
            return f"Error creating backup: {e}"

    # ── Tool 8: List Available Games ─────────────────────

    def list_games(self) -> str:
        """
        List all available game types (eggs) that can be deployed.

        Use this when the user asks "what games can you set up?",
        "what servers can you create?", or wants to see available options.
        """
        try:
            data = _get(
                f"{self.valves.PANEL_URL}/api/application/nests?include=eggs",
                _app_headers(self.valves),
                self.valves.REQUEST_TIMEOUT,
            )
            lines = []
            for nest in data.get("data", []):
                n = nest["attributes"]
                nest_name = n["name"]
                eggs = n.get("relationships", {}).get("eggs", {}).get("data", [])
                if eggs:
                    egg_names = [e["attributes"]["name"] for e in eggs]
                    lines.append(f"{nest_name}: {', '.join(egg_names)}")

            if not lines:
                return "No game eggs found. The panel may need eggs imported."

            return "Available game types:\n\n" + "\n".join(lines)
        except Exception as e:
            return f"Error listing games: {e}"

    # ── Tool 9: List Presets ─────────────────────────────

    def list_presets(
        self,
        game: str = Field(
            default="",
            description="Game to show presets for (e.g. 'minecraft', 'valheim'). Leave empty for all games.",
        ),
    ) -> str:
        """
        List available server presets with descriptions.

        Use this when the user asks "what kind of servers can you make?",
        "what presets do you have?", or when you need to help them choose
        between server types (e.g. vanilla vs modded). Also call this
        before creating a server if the user hasn't specified a preset.
        """
        presets = _load_presets(self.valves)
        if not presets:
            return "No presets configured. Use list_games to see raw egg types."

        game_filter = game.lower().strip()
        lines = []

        for game_key, game_presets in presets.items():
            if game_filter and game_filter != game_key:
                continue

            lines.append(f"\n{game_key.title()}:")
            for preset_key, p in game_presets.items():
                label = p.get("label", preset_key)
                desc = p.get("description", "")
                egg = p.get("egg", "?")
                mem = p.get("memory_mb", "?")
                mods = p.get("server_mods", [])

                line = f"  • {label} ({preset_key}) — {desc}"
                line += f"\n    Egg: {egg} | RAM: {mem}MB"
                if mods:
                    line += f"\n    Mods: {', '.join(mods)}"
                lines.append(line)

        if not lines:
            return f"No presets found for '{game}'. Available games: {', '.join(presets.keys())}"

        return "Server Presets:" + "\n".join(lines)

    # ── Tool 10: Create Server ───────────────────────────

    def create_server(
        self,
        name: str = Field(
            ..., description="Name for the new server (e.g. 'ATM10-Modded', 'Vanilla-MC')"
        ),
        game: str = Field(
            ...,
            description="Preset name, tag, or egg name (e.g. 'atm10', 'pure_vanilla', 'optimized', 'Paper', 'Valheim')",
        ),
        memory_mb: int = Field(
            default=0,
            description="Memory in MB (0 = use preset/egg default, typically 4096)",
        ),
        disk_mb: int = Field(
            default=0,
            description="Disk in MB (0 = use preset/egg default, typically 20480)",
        ),
    ) -> str:
        """
        Create a new game server from a preset or egg type.

        Use this when the user wants to spin up a new game server. Try to match
        against presets first (call list_presets if unsure), then fall back to
        raw egg names.

        IMPORTANT: After creation, some servers need configuration (e.g.
        CurseForge API key) through the Panel UI. Inform the user.
        """
        try:
            # Step 1: Try to resolve as a preset
            game_key, preset_key, preset_data = _resolve_preset(self.valves, game)

            if preset_data:
                egg_name = preset_data.get("egg", game)
                if memory_mb == 0:
                    memory_mb = preset_data.get("memory_mb", 4096)
                if disk_mb == 0:
                    disk_mb = preset_data.get("disk_mb", 20480)
                env_overrides = preset_data.get("env", {})
                preset_label = preset_data.get("label", preset_key)
            else:
                egg_name = game
                if memory_mb == 0:
                    memory_mb = 4096
                if disk_mb == 0:
                    disk_mb = 20480
                env_overrides = {}
                preset_label = None

            # Step 2: Find the egg
            egg_id, nest_id, egg_data = _find_egg(self.valves, egg_name)
            if not egg_id:
                presets = _load_presets(self.valves)
                suggestions = []
                for gk, gp in presets.items():
                    for pk, pd in gp.items():
                        suggestions.append(f"{pk} ({pd.get('label', pk)})")
                hint = f" Available presets: {', '.join(suggestions)}" if suggestions else ""
                return f"Game type '{game}' not found as preset or egg.{hint}"

            # Step 3: Find available port allocation
            alloc_id, alloc_port = _find_free_allocation(self.valves)
            if not alloc_id:
                return "No free port allocations available. Add more allocations in the Panel admin."

            # Step 4: Build environment from egg defaults + preset overrides
            env = {}
            docker_image = None
            startup = egg_data.get("startup", "")

            if egg_data.get("docker_images"):
                images = egg_data["docker_images"]
                if isinstance(images, dict):
                    for key in sorted(images.keys(), reverse=True):
                        docker_image = images[key]
                        break
                elif isinstance(images, list) and images:
                    docker_image = images[0]

            if not docker_image:
                docker_image = "ghcr.io/pterodactyl/yolks:java_21"

            variables = []
            try:
                egg_detail = _get(
                    f"{self.valves.PANEL_URL}/api/application/nests/{nest_id}/eggs/{egg_id}?include=variables",
                    _app_headers(self.valves),
                    self.valves.REQUEST_TIMEOUT,
                )
                variables = (
                    egg_detail.get("attributes", {})
                    .get("relationships", {})
                    .get("variables", {})
                    .get("data", [])
                )
                for v in variables:
                    va = v["attributes"]
                    env[va["env_variable"]] = va.get("default_value", "")
                startup = egg_detail.get("attributes", {}).get("startup", startup)
            except Exception:
                pass

            # Apply preset env overrides (non-empty values only)
            for k, v in env_overrides.items():
                if v:
                    env[k] = v

            payload = {
                "name": name,
                "user": 1,
                "egg": egg_id,
                "docker_image": docker_image,
                "startup": startup,
                "environment": env,
                "limits": {
                    "memory": memory_mb,
                    "swap": 0,
                    "disk": disk_mb,
                    "io": 0,
                    "cpu": 200,
                },
                "feature_limits": {
                    "databases": 0,
                    "backups": 3,
                    "allocations": 1,
                },
                "allocation": {"default": alloc_id},
                "start_on_completion": False,
            }

            r = _post(
                f"{self.valves.PANEL_URL}/api/application/servers",
                _app_headers(self.valves),
                payload,
                self.valves.REQUEST_TIMEOUT,
            )
            data = r.json()
            attrs = data.get("attributes", {})

            result = (
                f"Server '{name}' created successfully!\n"
                f"ID: {attrs.get('identifier', 'unknown')}\n"
            )
            if preset_label:
                result += f"Preset: {preset_label}\n"
            result += (
                f"Game: {egg_name}\n"
                f"Memory: {memory_mb}MB | Disk: {disk_mb}MB\n"
                f"Status: Installing (egg script running)\n"
            )

            # Connection instructions
            domain = self.valves.GAME_DOMAIN
            # Determine game-specific subdomain and version info
            game_lower = (game_key or egg_name or "").lower()
            mc_version = env.get("MINECRAFT_VERSION", env.get("MC_VERSION", ""))
            if mc_version == "latest":
                mc_version = "latest (check Panel for exact version after install)"

            if "minecraft" in game_lower or egg_name.lower() in ("paper", "fabric", "forge", "curseforge generic"):
                subdomain = f"mc.{domain}"
                default_port = 25565
                connect_info = f"\nConnection info:\n  Address: {subdomain}"
                if alloc_port and alloc_port != default_port:
                    connect_info += f":{alloc_port}"
                    connect_info += f"\n  (Non-standard port — SRV record only covers port {default_port})"
                if mc_version:
                    connect_info += f"\n  Version: {mc_version}"
                else:
                    connect_info += f"\n  Version: Check Panel after install completes"
                connect_info += f"\n  Java: {docker_image.split(':')[-1] if docker_image else 'unknown'}"
            elif "valheim" in game_lower:
                connect_info = f"\nConnection info:\n  Address: valheim.{domain}"
                if alloc_port:
                    connect_info += f":{alloc_port}"
                connect_info += f"\n  Join via Steam server browser or direct connect"
            elif "palworld" in game_lower:
                connect_info = f"\nConnection info:\n  Address: palworld.{domain}"
                if alloc_port:
                    connect_info += f":{alloc_port}"
            else:
                connect_info = ""
                if alloc_port:
                    connect_info = f"\nPort: {alloc_port}"

            result += connect_info + "\n"

            if preset_data and preset_data.get("server_mods"):
                result += (
                    f"\nIncluded mods (install manually via Panel file manager):\n"
                    + "\n".join(f"  • {m}" for m in preset_data["server_mods"])
                    + "\n"
                )

            required_vars = [
                v["attributes"]["name"]
                for v in variables
                if v["attributes"].get("rules", "")
                and "required" in v["attributes"]["rules"]
                and not env.get(v["attributes"]["env_variable"])
            ]
            if required_vars:
                result += (
                    f"\nRequired configuration (set in Panel UI):\n"
                    + "\n".join(f"  • {v}" for v in required_vars)
                )

            return result
        except Exception as e:
            return f"Error creating server: {e}"
