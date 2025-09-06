# Rails Architecture Plan

This document outlines how the trading platform would be implemented using Ruby on Rails, based on the existing architecture.

## Overview

The system will be restructured to take advantage of Rails' conventions and ecosystem while maintaining the same functionality as described in the original architecture.

## Component Mapping

### S3: Core API (Rails)

Rails would replace the Express.js Core API as the main application:

1. **Models** - Represent the domain entities:
   - User
   - Session
   - BrokerConnection
   - Trade
   - BiasTag
   - Rule
   - Digest
   - Audit
   - EventOutbox

2. **Controllers** - Handle API endpoints:
   - Api::V1::AuthController (login, signup, logout)
   - Api::V1::BrokersController (broker connections)
   - Api::V1::TradesController (trade management)
   - Api::V1::BiasTagsController (bias tagging)
   - Api::V1::RulesController (rules management)
   - Api::V1::DigestsController (weekly digests)
   - Api::V1::EventsController (event outbox)

3. **Jobs** - Background processing (ActiveJob with Sidekiq):
   - ImportTradesJob
   - ScoreBiasJob
   - SimulateSimpleJob
   - GenerateDigestJob

4. **Services** - Business logic:
   - AuthService
   - BrokerService
   - TradeService
   - BiasService
   - RuleService
   - DigestService
   - EventService

### S2: Edge/BFF

The Edge layer would remain as a separate Express.js application since Rails is not optimized for serving as a BFF with WebSocket relay capabilities.

### S4: Workers

Rails' ActiveJob with Sidekiq would replace BullMQ workers:
- Sidekiq for job processing
- Redis for queues (same as before)
- Same retry and backoff mechanisms

### S5: AI Coach

The Python AI Coach would remain unchanged, with Rails making HTTP requests to it instead of Node.js.

## Data Layer

Rails would use ActiveRecord to interface with Postgres:
- Same entity structure as defined in the ERD
- All IDs use nanoid instead of cuid
- EventOutbox pattern maintained for real-time events
- Same constraints and relationships

## Integration Adapters

Rails services would encapsulate integration logic:
- BrokerAdapters for Coinbase, Binance
- MarketDataAdapter for OHLCV data
- AIClient for communicating with AI Coach

## API Structure

Rails would expose the same internal REST API that the Express Core API currently provides to the Edge layer:
- JWT authentication
- Same endpoints and data structures
- Idempotency support
- Rate limiting (implemented via middleware)

## Real-time Events

Rails would use:
- ActionController::Live for SSE streams
- Redis pub/sub for internal event broadcasting
- EventOutbox pattern for persistence

## Background Jobs

ActiveJob with Sidekiq would handle:
- Trade imports from brokers
- Bias scoring with AI Coach
- Simulations
- Weekly digest generation

## Security

Rails' built-in security features would handle:
- CSRF protection
- Parameter sanitization
- Session management
- Content Security Policy
- Rate limiting via middleware

## Deployment

Rails application would be deployed as:
- Containerized application (Docker)
- Can be deployed to any container platform
- Redis and Postgres as separate services
- Sidekiq processes as separate containers