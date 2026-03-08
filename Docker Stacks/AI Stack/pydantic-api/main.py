from fastapi import FastAPI
from pydantic import BaseModel
from pydantic_ai import Agent
import httpx
import requests as sync_requests
import os

app = FastAPI(title="Atlas Agent — Pydantic AI Tool Bridge")

# --- Knowledge Base Config ---
OLLAMA_URL = os.getenv("OLLAMA_EMBED_URL", "http://ollama:11434")
QDRANT_URL = os.getenv("QDRANT_URL", "http://qdrant:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
QDRANT_COLLECTION = "atlas-knowledge"
STATIC_CHUNK_MAX_ID = 100  # IDs 1-100 reserved for static chunks
USER_CHUNK_START_ID = 1001  # User-added chunks start here

# Initialize a basic Pydantic AI Agent that connects to your local Ollama instance
agent = Agent(
    'ollama:qwen3:8b',
    system_prompt='You are a helpful, precise AI assistant integrated via Pydantic AI.',
)

class AIRequest(BaseModel):
    prompt: str
    context: str | None = None

class AIResponse(BaseModel):
    result: str
    status: str

class MCDeployReq(BaseModel):
    modpack: str = "All the Mods 10"
    mc_version: str = "1.21.1"
    ram_gb: int = 12
    disable_watchdog: bool = False

class MCDiagnoseReq(BaseModel):
    logs: str

@app.post("/api/process", response_model=AIResponse)
async def process_request(req: AIRequest):
    """Execute Pydantic AI agent against a prompt."""
    try:
        result = await agent.run(req.prompt)
        return AIResponse(result=result.data, status="success")
    except Exception as e:
         return AIResponse(result=str(e), status="error")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "framework": "pydantic-ai"}

@app.post("/api/tool/revive")
async def revive_ollama():
    """
    Attempt to revive the Ollama container if a failover occurs.
    Dispatches to n8n which has SSH access to the host for safe container restarts.
    """
    try:
        print("REVIVE SIGNAL RECEIVED. Initiating container restart sequence.")
        async with httpx.AsyncClient() as client:
            await client.post("http://n8n:5678/webhook/emergency-revive", timeout=5.0)
        return {"status": "revive_initiated", "method": "n8n_webhook_bridge"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/tool/deploy_minecraft")
async def deploy_minecraft(req: MCDeployReq):
    """
    Synthesizes a docker-compose.yml file for a Minecraft Modpack.
    Applies rigorous Aikar flags, Java version matching, and optional Watchdog disabling.
    """
    import os
    import yaml

    stack_dir = "/minecraft_stack"
    if not os.path.exists(stack_dir):
        return {"status": "error", "message": f"Target directory {stack_dir} not mounted."}

    # Java Engine Heuristics
    if "1.21" in req.mc_version or "1.20.5" in req.mc_version or "1.20.6" in req.mc_version:
        java_tag = ":java21"
    elif "1.20" in req.mc_version or "1.19" in req.mc_version or "1.18" in req.mc_version or "1.17" in req.mc_version:
        java_tag = ":java17"
    else:
        java_tag = ""
    image_target = f"itzg/minecraft-server{java_tag}"

    max_tick = "-1" if req.disable_watchdog else "60000"
    aikar_flags = "-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M"

    compose_config = {
        "services": {
            "mc": {
                "image": image_target,
                "container_name": "minecraft-server",
                "tty": True,
                "stdin_open": True,
                "ports": ["25565:25565"],
                "environment": {
                    "EULA": "TRUE",
                    "TYPE": "CURSEFORGE",
                    "CF_SERVER_MOD": req.modpack,
                    "MEMORY": f"{req.ram_gb}G",
                    "JVM_OPTS": aikar_flags,
                    "ENABLE_ROLLING_LOGS": "TRUE",
                    "VIEW_DISTANCE": "8",
                    "MAX_TICK_TIME": max_tick,
                    "CRON_BACKUP": "0 4 * * *"
                },
                "volumes": ["./data:/data"],
                "restart": "unless-stopped"
            }
        }
    }

    compose_path = os.path.join(stack_dir, "docker-compose.yml")
    try:
        with open(compose_path, 'w') as f:
            yaml.dump(compose_config, f, default_flow_style=False)
        print(f"Generated Minecraft Compose at {compose_path} for modpack: {req.modpack}")

        payload = {"stack_path": "/opt/docker-stacks/minecraft"}
        async with httpx.AsyncClient() as client:
            webhook_res = await client.post("http://n8n:5678/webhook/deploy-minecraft", json=payload, timeout=5.0)
            n8n_response = webhook_res.text if webhook_res.status_code == 200 else "n8n Webhook inaccessible"

        return {"status": "success", "message": "Compose written. Deployment triggered.", "java_routed": image_target, "n8n_response": n8n_response}
    except Exception as e:
         return {"status": "error", "message": str(e)}

@app.post("/api/tool/diagnose_crash")
async def diagnose_crash(req: MCDiagnoseReq):
    """
    Called by n8n when the Minecraft server container is continuously failing.
    Parses logs for OOM or Watchdog and re-triggers deploy_minecraft with self-healing parameters.
    """
    if "java.lang.OutOfMemoryError" in req.logs or "GC overhead limit exceeded" in req.logs:
        print("Crash Diagnosis: OOM detected. Self-Healing: Bumping RAM to 16GB.")
        fix_req = MCDeployReq(modpack="All the Mods 10", mc_version="1.21.1", ram_gb=16, disable_watchdog=False)
        res = await deploy_minecraft(fix_req)
        return {"status": "healed", "diagnosis": "OOM", "action": "Bumped RAM to 16GB", "deploy_result": res}

    elif "A single server tick took" in req.logs or "WatchingServer" in req.logs:
        print("Crash Diagnosis: Watchdog Tick Loop detected. Self-Healing: Disabling Max Tick Time.")
        fix_req = MCDeployReq(modpack="All the Mods 10", mc_version="1.21.1", ram_gb=12, disable_watchdog=True)
        res = await deploy_minecraft(fix_req)
        return {"status": "healed", "diagnosis": "Watchdog Loop", "action": "Disabled max-tick-time", "deploy_result": res}

    return {"status": "unknown", "message": "No recognizable crash signature found in logs."}


# --- Knowledge Base Admin Endpoints ---

def _qdrant_headers():
    return {"api-key": QDRANT_API_KEY, "Content-Type": "application/json"}


def _embed(text: str) -> list:
    resp = sync_requests.post(
        f"{OLLAMA_URL}/api/embed",
        json={"model": "nomic-embed-text", "input": text},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["embeddings"][0]


def _get_static_chunks() -> list[dict]:
    """Curated knowledge chunks. Edit these to update the knowledge base."""
    chunks = [
        {"title": "Hardware Specs", "text": "Primary host: Windows 11 with WSL2. GPU: NVIDIA RTX 5090 with 32GB GDDR7 VRAM. System RAM: 64GB. Storage: Speed Drive (C: SSD) for configs/databases, Mass Storage (B: HDD) for bulk data. Target server (future migration): AMD Ryzen 9 5950X, RTX 3080 Ti, 32GB DDR4."},
        {"title": "GPU and VRAM Management", "text": "RTX 5090 (32GB VRAM) runs two Qwen3 models simultaneously via Ollama. Operator (qwen3:8b) uses ~5GB VRAM and stays hot for instant responses. Architect (qwen3:32b) uses ~20GB VRAM, loaded on-demand. Both coexist with OLLAMA_MAX_MODELS=2, OLLAMA_KV_CACHE_TYPE=q4_0, OLLAMA_FLASH_ATTENTION=1. Total ~25GB when both loaded, leaving ~7GB headroom for GPU transcoding."},
        {"title": "AI Stack Overview", "text": "The AI Stack runs as a Docker Compose stack. Services: Ollama (LLM inference, GPU), Open WebUI (chat UI, port 3000), n8n (workflow automation, port 5678), PostgreSQL (n8n database), Qdrant (vector search, port 6333), pydantic-api (FastAPI tools, port 8000), Promptfoo (eval framework, port 3005), Unsloth (fine-tuning, port 8890), OTEL Collector (telemetry). All services share the default Docker network. Web-facing services also join web_proxy."},
        {"title": "Atlas Operator (Qwen3 8B)", "text": "The Atlas Operator is qwen3:8b running via Open WebUI. It uses native function calling with tools: docker_control, minecraft_control, system_status, knowledge_search, knowledge_admin. Each tool calls an n8n webhook or pydantic-api endpoint."},
        {"title": "Atlas Architect (Qwen3 32B)", "text": "The Atlas Architect is qwen3:32b, a larger reasoning model for self-improvement tasks. Used on-demand. An n8n Architect Review workflow runs daily at 3 AM, analyzing Operator performance and proposing improvements."},
        {"title": "n8n Workflows", "text": "n8n (port 5678) runs automation workflows: self_healing_v3 (Docker health every 5min), minecraft_bot (server control), global_error_handler (catches all errors), promptfoo_eval (weekly eval). Uses PostgreSQL for persistence. Runs as root for Docker socket access. Concurrency limit: 1."},
        {"title": "Fundamental Stack", "text": "Core infrastructure: Nginx Proxy Manager (NPM, ports 80/443/81), Komodo Core + Periphery (Docker dashboard), MongoDB (Komodo database, 1GB limit), Cloudflare DDNS (auto-updates DNS)."},
        {"title": "Observability Stack", "text": "Monitoring: Prometheus (scrapes cAdvisor + OTEL Collector), Grafana (dashboards), Uptime Kuma (service uptime), cAdvisor (container metrics), OTEL Collector (receives OpenTelemetry from Open WebUI, exports to Prometheus)."},
        {"title": "Minecraft Stack", "text": "Minecraft server with 16GB heap (20GB total Docker limit). Managed via minecraft_control tool and n8n workflow. CurseForge modpack support. Self-healing via pydantic-api crash diagnosis."},
        {"title": "Self-Healing System", "text": "Self-healing v3 (n8n workflow) runs every 5 minutes: queries Docker socket for health status, restarts containers unhealthy for 2+ consecutive checks, escalates after 3 failed restarts. Monitored: n8n, ollama, open-webui, pydantic-api, qdrant, jellyfin, navidrome, npm, otel-collector."},
        {"title": "Promptfoo Evaluation", "text": "Promptfoo (port 3005) evaluates Operator tool calling accuracy. 20 test cases covering all tools + no-tool conversations. Baseline: 100% (20/20). Weekly Mon 3AM via n8n."},
        {"title": "Media Server", "text": "Jellyfin (port 8096) for video streaming with GPU transcoding via NVENC. Navidrome (port 4533) for music streaming with Subsonic API. Feishin (port 9180) as web music player. Beets for metadata management. JFA-Go for user account management."},
        {"title": "Networking", "text": "Docker networks: web_proxy (external, shared by all stacks for reverse proxy/cross-stack), default (per-stack internal). Reverse proxy: Nginx Proxy Manager (NPM, ports 80/443/81). Domain: lonebeast.net via Cloudflare. DDNS via cloudflare-ddns container."},
        {"title": "Storage Paths", "text": "Speed Drive (C: SSD) for configs/databases. Mass Storage (B: HDD) for media files. Docker volumes: ollama_data (named volume for Ollama models). Per-stack data/ directories for service persistence."},
        {"title": "Pydantic API", "text": "pydantic-api (port 8000) is a FastAPI service. Endpoints: POST /api/process (AI agent), POST /api/tool/deploy_minecraft (MC deployment), POST /api/tool/diagnose_crash (self-healing), POST /api/tool/revive (container restart), knowledge CRUD endpoints, study quiz endpoints."},
    ]

    # Add dynamic chunk: current Ollama models
    try:
        resp = sync_requests.get(f"{OLLAMA_URL}/api/tags", timeout=10)
        if resp.status_code == 200:
            models = resp.json().get("models", [])
            model_lines = [f"{m['name']} ({m.get('size',0)//1_000_000_000}GB)" for m in models]
            chunks.append({
                "title": "Currently Installed Ollama Models",
                "text": f"Models available in Ollama: {', '.join(model_lines)}. Use 'docker exec ollama ollama ps' to see which are currently loaded in VRAM.",
            })
    except Exception:
        pass

    return chunks


def _next_user_chunk_id() -> int:
    """Find the next available ID for user-added chunks."""
    try:
        resp = sync_requests.post(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/scroll",
            headers=_qdrant_headers(),
            json={"limit": 500, "with_payload": False, "with_vector": False},
            timeout=10,
        )
        if resp.status_code == 200:
            points = resp.json().get("result", {}).get("points", [])
            user_ids = [p["id"] for p in points if isinstance(p["id"], int) and p["id"] >= USER_CHUNK_START_ID]
            return max(user_ids, default=USER_CHUNK_START_ID - 1) + 1
    except Exception:
        pass
    return USER_CHUNK_START_ID


class KnowledgeAddRequest(BaseModel):
    title: str
    text: str


@app.post("/api/tool/knowledge/refresh")
async def knowledge_refresh():
    """Wipe static chunks and re-ingest from curated sources + live data."""
    try:
        static_ids = list(range(1, STATIC_CHUNK_MAX_ID + 1))
        sync_requests.post(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/delete",
            headers=_qdrant_headers(),
            json={"points": static_ids},
            timeout=30,
        )

        chunks = _get_static_chunks()
        ingested = 0
        for i, chunk in enumerate(chunks):
            point_id = i + 1
            search_text = f"{chunk['title']}: {chunk['text']}"
            vector = _embed(search_text)
            sync_requests.put(
                f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points",
                headers=_qdrant_headers(),
                json={"points": [{"id": point_id, "vector": vector, "payload": {"title": chunk["title"], "text": chunk["text"], "source": "static"}}]},
                timeout=30,
            )
            ingested += 1

        return {"status": "success", "message": f"Knowledge base refreshed. {ingested} static chunks ingested.", "chunks_ingested": ingested}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/tool/knowledge/add")
async def knowledge_add(req: KnowledgeAddRequest):
    """Add a new user-defined knowledge chunk."""
    try:
        point_id = _next_user_chunk_id()
        search_text = f"{req.title}: {req.text}"
        vector = _embed(search_text)
        sync_requests.put(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points",
            headers=_qdrant_headers(),
            json={"points": [{"id": point_id, "vector": vector, "payload": {"title": req.title, "text": req.text, "source": "user"}}]},
            timeout=30,
        )
        return {"status": "success", "message": f"Knowledge added: '{req.title}' (ID: {point_id})", "id": point_id}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.get("/api/tool/knowledge/list")
async def knowledge_list():
    """List all knowledge chunks in the collection."""
    try:
        resp = sync_requests.post(
            f"{QDRANT_URL}/collections/{QDRANT_COLLECTION}/points/scroll",
            headers=_qdrant_headers(),
            json={"limit": 500, "with_payload": True, "with_vector": False},
            timeout=10,
        )
        if resp.status_code != 200:
            return {"status": "error", "message": f"Qdrant returned {resp.status_code}"}
        points = resp.json().get("result", {}).get("points", [])
        entries = []
        for p in sorted(points, key=lambda x: x["id"]):
            entries.append({
                "id": p["id"],
                "title": p["payload"].get("title", "?"),
                "source": p["payload"].get("source", "unknown"),
                "preview": p["payload"].get("text", "")[:80] + "...",
            })
        return {"status": "success", "count": len(entries), "entries": entries}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ==========================================================================
# Study Quiz Endpoints (Atlas Tutor)
# ==========================================================================

import random
import re as _re
from pathlib import Path as _Path

STUDY_JOURNAL = _Path("/study-journal/Services")
KNOWLEDGE_VAULT = _Path("/knowledge-vault/Codemap")

QUIZ_QUESTIONS = [
    ("what_does", "What does {service} do in your homelab?"),
    ("why_need", "Why do you need {service}? What problem does it solve?"),
    ("depends_on", "What services does {service} depend on, and why?"),
    ("used_by", "What other services depend on {service}?"),
    ("break_if_down", "What would break in your homelab if {service} went down?"),
    ("config_gotcha", "What's a key configuration detail or gotcha about {service}?"),
    ("overlap", "What capabilities of {service} are you NOT using? Could you leverage them?"),
]


def _read_frontmatter(path: _Path) -> dict:
    """Read YAML frontmatter from a markdown file."""
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    if end == -1:
        return {}
    fm = {}
    for line in text[3:end].strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            v = v.strip().strip('"').strip("'")
            fm[k.strip()] = v
    return fm


def _read_section(path: _Path, heading: str) -> str:
    """Extract content under a markdown heading."""
    text = path.read_text(encoding="utf-8")
    pattern = _re.compile(r"^##\s+" + _re.escape(heading) + r"\s*$", _re.MULTILINE)
    match = pattern.search(text)
    if not match:
        return ""
    start = match.end()
    next_heading = _re.search(r"^##\s+", text[start:], _re.MULTILINE)
    end = start + next_heading.start() if next_heading else len(text)
    return text[start:end].strip()


@app.get("/api/tool/study/quiz")
async def study_quiz(service: str = None, stack: str = None):
    """Get a quiz question from the Study Journal."""
    try:
        if not STUDY_JOURNAL.exists():
            return {"status": "error", "message": "Study Journal not mounted at /study-journal"}

        notes = list(STUDY_JOURNAL.glob("*.md"))
        if not notes:
            return {"status": "error", "message": "No study notes found"}

        if stack:
            filtered = []
            for n in notes:
                fm = _read_frontmatter(n)
                if stack.lower() in fm.get("stack", "").lower():
                    filtered.append(n)
            if filtered:
                notes = filtered

        if service:
            matching = [n for n in notes if n.stem.lower() == service.lower()]
            if matching:
                note_path = matching[0]
            else:
                return {"status": "error", "message": f"Service '{service}' not found", "available": [n.stem for n in notes]}
        else:
            note_path = random.choice(notes)

        svc_name = note_path.stem
        fm = _read_frontmatter(note_path)
        confidence = fm.get("confidence", "low")

        if confidence == "high":
            q_pool = [q for q in QUIZ_QUESTIONS if q[0] in ("break_if_down", "overlap", "config_gotcha")]
        elif confidence == "medium":
            q_pool = [q for q in QUIZ_QUESTIONS if q[0] in ("depends_on", "used_by", "break_if_down", "config_gotcha")]
        else:
            q_pool = [q for q in QUIZ_QUESTIONS if q[0] in ("what_does", "why_need", "depends_on")]

        q_type, q_template = random.choice(q_pool)
        question = q_template.format(service=svc_name)

        kv_path = KNOWLEDGE_VAULT / f"{svc_name}.md"
        correct_answer = ""
        hint = ""

        if kv_path.exists():
            if q_type in ("what_does", "why_need"):
                correct_answer = _read_section(kv_path, "Service Metadata")
                hint = f"Think about what {fm.get('image', 'this image')} is designed for."
            elif q_type == "depends_on":
                correct_answer = _read_section(kv_path, "Dependencies")
                hint = "Check the 'Depends on' line."
            elif q_type == "used_by":
                correct_answer = _read_section(kv_path, "Dependencies")
                hint = "Think about what services reference this one."
            elif q_type == "break_if_down":
                correct_answer = _read_section(kv_path, "Dependencies")
                hint = "Look at the 'Used by' list — those would all be affected."
            elif q_type == "overlap":
                correct_answer = _read_section(kv_path, "Overlap Metric")
                hint = "Check the utilization percentage and unused capabilities."
            elif q_type == "config_gotcha":
                correct_answer = f"Stack: {fm.get('stack', '?')}, Image: {fm.get('image', '?')}"
                hint = "Think about environment variables, volume mounts, or network mode."

        return {
            "status": "success",
            "service": svc_name,
            "stack": fm.get("stack", "unknown"),
            "question_type": q_type,
            "question": question,
            "hint": hint,
            "correct_answer": correct_answer,
            "current_confidence": confidence,
            "last_reviewed": fm.get("last_reviewed", "never"),
        }

    except Exception as e:
        return {"status": "error", "message": str(e)}


class StudyUpdateReq(BaseModel):
    service: str
    confidence: str = None  # low, medium, high
    reviewed: bool = True


@app.post("/api/tool/study/update")
async def study_update(req: StudyUpdateReq):
    """Update confidence and last_reviewed for a Study Journal note."""
    try:
        note_path = STUDY_JOURNAL / f"{req.service}.md"
        if not note_path.exists():
            return {"status": "error", "message": f"Note not found: {req.service}"}

        text = note_path.read_text(encoding="utf-8")
        today = __import__("datetime").date.today().isoformat()

        if req.reviewed:
            text = _re.sub(r"^last_reviewed:.*$", f"last_reviewed: {today}", text, flags=_re.MULTILINE)
        if req.confidence and req.confidence in ("low", "medium", "high"):
            text = _re.sub(r"^confidence:.*$", f"confidence: {req.confidence}", text, flags=_re.MULTILINE)

        note_path.write_text(text, encoding="utf-8")
        return {
            "status": "success",
            "service": req.service,
            "confidence": req.confidence or "unchanged",
            "last_reviewed": today if req.reviewed else "unchanged",
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
