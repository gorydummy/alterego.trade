# Rails-Based System Architecture Diagram

This diagram shows the complete architecture of the trading platform with Ruby on Rails as the core implementation technology.

```mermaid
flowchart TB
    subgraph Clients["Clients"]
        WebUI["S1: Web-UI (Next.js)<br/>Browser Application<br/>- Dashboard<br/>- Chat (coach reflections)<br/>- Digest<br/>- Rules/Settings"]
        Mobile["Mobile App<br/>(Planned)"]
    end

    subgraph EdgeLayer["Edge Layer (Public Facing)"]
        Edge["S2: Edge/BFF (Express)<br/>Public Facade<br/>- Session Management (JWT)<br/>- CSRF Protection<br/>- Rate Limiting<br/>- DTO Validation<br/>- Idempotency Enforcement<br/>- WebSocket Relay"]
    end

    subgraph RailsLayer["Rails Core Services Layer"]
        RailsApp["Rails Application<br/>Business Logic & Data<br/>- Models (User, Trade, BiasTag, etc.)<br/>- Controllers (API endpoints)<br/>- Services (Business logic)<br/>- ActiveJob (Background jobs)<br/>- Event Outbox Writer"]
        
        Sidekiq["Sidekiq Workers<br/>Background Processing<br/>- Trade Import<br/>- Bias Scoring<br/>- Simulations<br/>- Weekly Digests"]
    end

    subgraph DataLayer["Data Layer"]
        Postgres[("Postgres Database<br/>Entities:<br/>- Users<br/>- Sessions<br/>- Broker Connections<br/>- Trades<br/>- Bias Tags<br/>- Rules<br/>- Digests<br/>- Audits<br/>- Event Outbox")]
        Redis[("Redis<br/>- Cache<br/>- Queue Backends (Sidekiq)")]
        S3[("Object Storage (S3/MinIO)<br/>- OHLCV Snapshots<br/>- Exported Reports")]
    end

    subgraph External["External Systems"]
        Brokers["Broker APIs<br/>(Coinbase, Binance)<br/>- OAuth Authentication<br/>- Trade Data<br/>- Market Data"]
        MarketData["Market Data Providers<br/>(Fallback Services)"]
        AICoach["AI Coach (FastAPI)<br/>- Indicator Calculation<br/>- Bias Scoring Heuristics<br/>- Natural Language Generation"]
    end

    %% Connections
    WebUI -- HTTPS/REST --> Edge
    WebUI <-. WebSocket .-> Edge
    
    Mobile -- HTTPS/REST --> Edge
    Mobile <-. WebSocket .-> Edge

    Edge -- Internal REST --> RailsApp
    Edge <-. SSE (Events) .-> RailsApp

    RailsApp -- SQL --> Postgres
    RailsApp -- Cache --> Redis
    RailsApp -- enqueue --> Redis
    RailsApp --> S3

    Sidekiq -. consume .-> Redis
    Sidekiq -- SQL --> Postgres
    Sidekiq -- Cache --> Redis
    Sidekiq --> S3

    RailsApp -- HMAC --> AICoach
    Sidekiq -- HMAC --> AICoach

    Sidekiq -- API Calls --> Brokers
    Sidekiq -- API Calls --> MarketData
    RailsApp -- API Calls --> Brokers

    classDef client fill:#8B4513,stroke:#fff,color:#fff;
    classDef edge fill:#00008B,stroke:#fff,color:#fff;
    classDef rails fill:#8B0000,stroke:#fff,color:#fff;
    classDef data fill:#006400,stroke:#fff,color:#fff;
    classDef external fill:#4B0082,stroke:#fff,color:#fff;
    
    class WebUI,Mobile client
    class Edge edge
    class RailsApp,Sidekiq rails
    class Postgres,Redis,S3 data
    class Brokers,MarketData,AICoach external
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
- No direct database access - proxies requests to Rails Core

### Rails Application
- Central business logic and data management using Ruby on Rails
- Implements all domain entities as ActiveRecord models
- Exposes internal REST API consumed by Edge
- Uses Service Objects for business logic
- Implements EventOutbox pattern for real-time events
- Enqueues background jobs using ActiveJob

### Sidekiq Workers
- Background job processing using ActiveJob with Sidekiq backend
- Trade import from broker APIs
- Bias scoring using AI Coach service
- Trade simulations
- Weekly digest generation
- Uses Redis for job queues and caching

### S5: AI Coach (FastAPI)
- Provides AI-powered services to Rails application
- Calculates trading indicators
- Applies heuristic bias scoring
- Generates natural language reflections
- Secured with HMAC-signed requests

### Data Layer
- Postgres: Primary database with all business entities (ActiveRecord models)
- Redis: Caching and job queue backends for Sidekiq
- S3: Object storage for snapshots and reports

### External Systems
- Broker APIs: Primary source of trading data
- Market Data Providers: Fallback data sources
- AI Coach: Python-based AI services

## Key Implementation Details

1. **ID Generation**: All entities use nanoid instead of cuid for ID generation
2. **API Compatibility**: Rails exposes the same internal REST API as the previous Express implementation
3. **Background Jobs**: ActiveJob with Sidekiq replaces BullMQ for background processing
4. **Event System**: EventOutbox pattern maintained for real-time events with SSE support
5. **Security**: Rails' built-in security features handle CSRF, parameter sanitization, and session management
6. **Integration**: Rails services encapsulate integration logic with brokers and market data providers