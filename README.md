# Atlas Agent

A production-grade, multi-stack Docker infrastructure platform running 30+ containers across 7 orchestrated stacks on a single host. Built for AI inference, media streaming, game server hosting, workflow automation, observability, and real-time infrastructure monitoring.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Nginx Proxy Manager (SSL)                     │
│                    Cloudflare DNS / Zero Trust                   │
├─────────┬──────────┬──────────┬──────────┬──────────┬───────────┤
│ AI Stack│ Ops Stack│Fund Stack│Game Stack│ MC Stack │Media Stack│
│         │          │          │          │          │           │
│ Ollama  │Prometheus│   NPM    │Pterodact.│Minecraft │ Jellyfin  │
│ OpenWebUI│ Grafana │  Komodo  │  Wings   │  Server  │ Navidrome │
│  n8n    │ cAdvisor │  DDNS    │ MariaDB  │          │  Feishin  │
│ Qdrant  │ NodeExp  │  Mongo   │  Redis   │          │  Beets    │
│Pydantic │ Uptime-K │          │          │          │  JFA-Go   │
│Promptfoo│Watchtower│          │          │          │           │
│ Unsloth │ Homepage │          │          │          │           │
│  OTEL   │          │          │          │          │           │
│ SearXNG │          │          │          │          │           │
│Postgres │          │          │          │          │           │
├─────────┴──────────┴──────────┴──────────┴──────────┴───────────┤
│              Last Resort Hub (Real-Time Dashboard)               │
│          SpacetimeDB + Bun/Hono Gateway + React 19               │
└─────────────────────────────────────────────────────────────────┘
```

## Key Features

### AI Inference Platform
- **Two-tier LLM architecture**: Qwen 3 8B (fast) + Qwen 3 32B (deep reasoning) coexisting on a single RTX 5090 (32GB VRAM)
- **Quantized KV cache** (q4_0) + flash attention for VRAM efficiency
- **RAG pipeline**: Qdrant vector DB with curated knowledge + dynamic model inventory
- **AI agent tool use**: FastAPI endpoints expose structured tools that LLMs invoke via function calling
- **LLM evaluation**: Promptfoo benchmarking with 20 test cases, 100% baseline accuracy
- **Fine-tuning**: Unsloth + Jupyter environment with full GPU access

### Self-Healing Infrastructure
- n8n workflow monitors Docker health every 5 minutes
- Automatic container restart after 2+ consecutive failures
- **Minecraft crash recovery**: OOM detection → RAM adjustment → redeployment (fully autonomous)
- Watchdog loop detection → config adjustment → redeployment

### Real-Time Operations Dashboard (Last Resort Hub)
- **SpacetimeDB** (Rust-based) for real-time state synchronization
- **Bun + Hono** API gateway polling 5+ services every 30 seconds
- **React 19** dashboard with 9 draggable widgets, responsive grid, layout presets
- **Dual-path resilience**: WebSocket subscriptions + REST polling fallback

### Full Observability Pipeline
- Prometheus (30-day retention) + Grafana dashboards
- cAdvisor (container metrics) + Node Exporter (host OS)
- OpenTelemetry traces from AI workloads
- Uptime Kuma for independent service health checks

### Game Server Management
- Pterodactyl Panel + Wings for multi-server orchestration
- Docker sibling containers with isolated resources
- AI-powered Minecraft deployment from natural language

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Infrastructure** | Docker, Docker Compose, Nginx Proxy Manager, Cloudflare DNS/Zero Trust, WSL2 |
| **AI/ML** | Ollama, Pydantic AI, Qdrant, Promptfoo, Unsloth, OpenTelemetry |
| **Backend** | Python (FastAPI), TypeScript (Bun, Hono), Node.js (n8n) |
| **Frontend** | React 19, Vite 7, Tailwind CSS 4, react-grid-layout |
| **Databases** | PostgreSQL, MongoDB, MariaDB, Redis, SpacetimeDB, Qdrant |
| **Monitoring** | Prometheus, Grafana, cAdvisor, Node Exporter, Uptime Kuma |
| **Media** | Jellyfin (GPU NVENC), Navidrome, Feishin |
| **Gaming** | Pterodactyl Panel + Wings, itzg/minecraft-server |

## Hardware

- **GPU**: NVIDIA RTX 5090 (32GB GDDR7 VRAM)
- **RAM**: 64GB DDR5
- **Storage**: 1TB NVMe SSD (configs/databases) + 3.7TB HDD (bulk data)
- **OS**: Windows 11 Pro + WSL2

## Getting Started

1. Clone the repository
2. Copy `.env.example` to `.env` in each stack directory and fill in your secrets
3. Create the shared Docker network: `docker network create web_proxy`
4. Start stacks in order:
   ```bash
   # Core infrastructure first
   docker compose -f "Docker Stacks/Fundamental Stack/docker-compose.yml" up -d

   # Then supporting services
   docker compose -f "Docker Stacks/Ops Stack/docker-compose.yml" up -d

   # Then application stacks
   docker compose -f "Docker Stacks/AI Stack/docker-compose.yml" up -d
   docker compose -f "Docker Stacks/Media Stack/docker-compose.yml" up -d
   docker compose -f "Docker Stacks/Game Stack/docker-compose.yml" up -d
   docker compose -f "Docker Stacks/Minecraft Stack/docker-compose.yml" up -d

   # Dashboard last (depends on other stacks)
   docker compose -f "Docker Stacks/last-resort-hub/docker-compose.yml" up -d
   ```

## Project Structure

```
atlas-agent-portfolio/
├── Docker Stacks/
│   ├── AI Stack/           # LLM inference, automation, knowledge base
│   ├── Fundamental Stack/  # Reverse proxy, infra management, DNS
│   ├── Ops Stack/          # Monitoring, dashboards, auto-updates
│   ├── Game Stack/         # Pterodactyl game server management
│   ├── Minecraft Stack/    # Modded MC server with self-healing
│   ├── Media Stack/        # Jellyfin, Navidrome, music tools
│   └── last-resort-hub/    # Real-time operations dashboard
│       ├── api-gateway/    # Bun + Hono REST aggregator
│       ├── stdb-backend/   # SpacetimeDB schema + reducers
│       └── web-frontend/   # React 19 dashboard SPA
└── README.md
```

## License

MIT
