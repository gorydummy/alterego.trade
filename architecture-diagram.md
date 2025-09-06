# System Architecture Diagram

This diagram shows the complete architecture of the trading platform, including all five main stacks and their interactions.

```mermaid
flowchart TB
    subgraph Clients["Clients"]
        WebUI["S1: Web-UI (Next.js)<br/>Browser Application<br/>- Dashboard<br/>- Chat (coach reflections)<br/>- Digest<br/>- Rules/Settings"]
        Mobile["Mobile App<br/>(Planned)"]
    end

    subgraph EdgeLayer["Edge Layer (Public Facing)"]
        Edge["S2: Edge/BFF (Express)<br/>Public Facade<br/>- Session Management (JWT)<br/>- CSRF Protection<br/>- Rate Limiting<br/>- DTO Validation<br/>- Idempotency Enforcement<br/>- WebSocket Relay"]
    end

    subgraph CoreLayer["Core Services Layer"]
        CoreAPI["S3: Core API (Express)<br/>Business Logic & Data<br/>- User Management<br/>- Broker Connections<br/>- Trade Management<br/>- Bias Tagging<br/>- Rules Engine<br/>- Digest Generation<br/>- Event Outbox Writer"]
        
        Workers["S4: Workers (BullMQ)<br/>Background Processing<br/>- Trade Import (import.trades)<br/>- Bias Scoring (score.bias)<br/>- Simulations (simulate.simple)<br/>- Weekly Digests (digest.weekly)"]
        
        AICoach["S5: AI Coach (FastAPI)<br/>AI Services<br/>- Indicator Calculation<br/>- Bias Scoring Heuristics<br/>- Natural Language Generation"]
    end

    subgraph DataLayer["Data Layer"]
        Postgres[("Postgres Database<br/>Entities:<br/>- Users<br/>- Sessions<br/>- Broker Connections<br/>- Trades<br/>- Bias Tags<br/>- Rules<br/>- Digests<br/>- Audits<br/>- Event Outbox")]
        Redis[("Redis<br/>- Cache<br/>- Queue Backends (BullMQ)")]
        S3[("Object Storage (S3/MinIO)<br/>- OHLCV Snapshots<br/>- Exported Reports")]
    end

    subgraph External["External Systems"]
        Brokers["Broker APIs<br/>(Coinbase, Binance)<br/>- OAuth Authentication<br/>- Trade Data<br/>- Market Data"]
        MarketData["Market Data Providers<br/>(Fallback Services)"]
    end

    %% Connections
    WebUI -- HTTPS/REST --> Edge
    WebUI <-. WebSocket .-> Edge
    
    Mobile -- HTTPS/REST --> Edge
    Mobile <-. WebSocket .-> Edge

    Edge -- Internal REST --> CoreAPI
    Edge <-. SSE (Events) .-> CoreAPI

    CoreAPI -- SQL --> Postgres
    CoreAPI -- Cache --> Redis
    CoreAPI -- enqueue --> Redis
    CoreAPI --> S3

    Workers -. consume .-> Redis
    Workers -- SQL --> Postgres
    Workers -- Cache --> Redis
    Workers --> S3

    CoreAPI -- HMAC --> AICoach
    Workers -- HMAC --> AICoach

    Workers -- API Calls --> Brokers
    Workers -- API Calls --> MarketData
    CoreAPI -- API Calls --> Brokers

    classDef client fill:#8B4513,stroke:#fff,color:#fff;
    classDef edge fill:#00008B,stroke:#fff,color:#fff;
    classDef core fill:#006400,stroke:#fff,color:#fff;
    classDef data fill:#8B0000,stroke:#fff,color:#fff;
    classDef external fill:#4B0082,stroke:#fff,color:#fff;
    
    class WebUI,Mobile client
    class Edge edge
    class CoreAPI,Workers,AICoach core
    class Postgres,Redis,S3 data
    class Brokers,MarketData external
```

## Component Responsibilities

### S1: Web-UI (Next.js)
- User-facing web application
- Dashboard with trading insights
- Chat interface for coach reflections
- Weekly digest viewer
- Rules and settings management
- Uses cookie-based sessions (no direct DB access)
- Communicates with Edge via REST and WebSocket

### S2: Edge/BFF (Express)
- Public API facade for web and mobile clients
- Session management with JWT tokens
- CSRF protection and rate limiting
- DTO validation and idempotency enforcement
- WebSocket relay with event replay capability
- No direct database access - proxies requests to Core API

### S3: Core API (Express)
- Central business logic and data management
- User, session, and broker connection management
- Trade and bias tag handling
- Rules engine and digest generation
- Event outbox writer for all user events
- Internal REST API consumed by Edge
- Enqueues background jobs for Workers

### S4: Workers (BullMQ)
- Background job processing
- Trade import from broker APIs
- Bias scoring using AI Coach service
- Trade simulations
- Weekly digest generation
- Uses Redis for job queues and caching

### S5: AI Coach (FastAPI)
- Provides AI-powered services to Core and Workers
- Calculates trading indicators
- Applies heuristic bias scoring
- Generates natural language reflections
- Secured with HMAC-signed requests

### Data Layer
- Postgres: Primary database with all business entities
- Redis: Caching and job queue backends
- S3: Object storage for snapshots and reports

### External Systems
- Broker APIs: Primary source of trading data
- Market Data Providers: Fallback data sources