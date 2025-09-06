# Rails Services

This document describes how business logic would be organized into service objects in the Rails implementation.

## Service Base Class

```ruby
# app/services/application_service.rb
class ApplicationService
  attr_reader :current_user
  
  def initialize(current_user = nil)
    @current_user = current_user
  end
  
  private
  
  def ensure_user!
    raise "User required" unless current_user
  end
end
```

## Authentication Service

```ruby
# app/services/auth_service.rb
class AuthService < ApplicationService
  def signup(email:, password:)
    user = User.create!(
      email: email,
      password: password
    )
    
    session = Session.create!(
      user: user,
      expires_at: 24.hours.from_now
    )
    
    token = AuthToken.issue_token(user)
    
    { user: user, token: token, session: session }
  end
  
  def login(email:, password:)
    user = User.find_by!(email: email)
    
    if user.authenticate(password)
      session = Session.create!(
        user: user,
        expires_at: 24.hours.from_now
      )
      
      token = AuthToken.issue_token(user)
      
      { user: user, token: token, session: session }
    else
      raise "Invalid credentials"
    end
  end
  
  def logout(session_id:)
    session = Session.find(session_id)
    session.destroy!
  end
end
```

## Broker Service

```ruby
# app/services/broker_service.rb
class BrokerService < ApplicationService
  def initialize(current_user)
    super(current_user)
    ensure_user!
  end
  
  def connect(broker:)
    connection = current_user.broker_connections.create!(
      broker: broker,
      status: 'active'
    )
    
    # Return OAuth URL for redirect
    adapter = BrokerAdapterFactory.for(broker)
    adapter.oauth_url(connection)
  end
  
  def handle_oauth_callback(params)
    # Implementation for handling OAuth callback
    # Exchange code for tokens and store encrypted tokens
  end
  
  def refresh_tokens(broker_connection)
    # Refresh access tokens using refresh token
    adapter = BrokerAdapterFactory.for(broker_connection.broker)
    new_tokens = adapter.refresh_access_token(broker_connection.refresh_token)
    
    # Update encrypted tokens
    broker_connection.update!(
      access_enc: encrypt_token(new_tokens[:access_token]),
      refresh_enc: encrypt_token(new_tokens[:refresh_token]),
      expires_at: new_tokens[:expires_at]
    )
  end
  
  private
  
  def encrypt_token(token)
    # Encrypt token using application's encryption service
    TokenEncryptionService.encrypt(token)
  end
end
```

## Trade Service

```ruby
# app/services/trade_service.rb
class TradeService < ApplicationService
  def initialize(current_user)
    super(current_user)
    ensure_user!
  end
  
  def import_trades(since_iso:, broker: nil)
    # Enqueue import job
    job_id = ImportTradesJob.perform_later(
      user_id: current_user.id,
      since_iso: since_iso,
      broker: broker
    )
    
    job_id
  end
  
  def list_trades(since: nil, until: nil, cursor: nil, limit: 50)
    trades = current_user.trades
    
    trades = trades.where('ts >= ?', since) if since
    trades = trades.where('ts <= ?', until) if until
    
    trades = trades.order(ts: :desc).limit(limit)
    
    # Handle cursor-based pagination if needed
    if cursor
      # Implementation for cursor-based pagination
    end
    
    trades
  end
end
```

## Bias Service

```ruby
# app/services/bias_service.rb
class BiasService < ApplicationService
  def initialize(current_user)
    super(current_user)
    ensure_user!
  end
  
  def get_trade_bias(trade_id)
    trade = current_user.trades.find(trade_id)
    trade.bias_tags
  end
  
  def score_bias(since_iso:)
    # Enqueue bias scoring job
    job_id = ScoreBiasJob.perform_later(
      user_id: current_user.id,
      since_iso: since_iso
    )
    
    job_id
  end
end
```

## Rule Service

```ruby
# app/services/rule_service.rb
class RuleService < ApplicationService
  def initialize(current_user)
    super(current_user)
    ensure_user!
  end
  
  def list_rules
    current_user.rules
  end
  
  def upsert_rule(kind:, params:, active: true)
    rule = current_user.rules.find_or_initialize_by(kind: kind)
    rule.update!(
      params: params,
      active: active
    )
    
    rule
  end
  
  def evaluate_rules_on_import(trade)
    # Apply active rules to a trade during import
    current_user.rules.active.each do |rule|
      RuleEvaluator.new(rule).evaluate(trade)
    end
  end
end
```

## Digest Service

```ruby
# app/services/digest_service.rb
class DigestService < ApplicationService
  def initialize(current_user)
    super(current_user)
    ensure_user!
  end
  
  def get_latest_digest
    current_user.digests.order(created_at: :desc).first
  end
  
  def generate_weekly_digest(period_start:, period_end:)
    # Enqueue digest generation job
    job_id = GenerateDigestJob.perform_later(
      user_id: current_user.id,
      period_start: period_start,
      period_end: period_end
    )
    
    job_id
  end
end
```

## Event Service

```ruby
# app/services/event_service.rb
class EventService < ApplicationService
  def self.append_event(user:, type:, payload:, v: 1)
    EventOutbox.create!(
      id: SecureRandom.uuid, # ULID in actual implementation
      user: user,
      type: type,
      v: v,
      payload: payload,
      ts: Time.current
    )
  end
  
  def list_events(since_event_id:)
    # Lookup anchor timestamp and ID
    anchor = EventOutbox.find_by(id: since_event_id)
    return [] unless anchor
    
    EventOutbox
      .where(user: current_user)
      .where(
        'ts > ? OR (ts = ? AND id > ?)', 
        anchor.ts, anchor.ts, since_event_id
      )
      .order(:ts, :id)
      .limit(500)
  end
  
  def self.subscribe_to_user_events(user_id)
    # Implementation for subscribing to user events
    # Could use Redis pub/sub or other mechanisms
  end
end
```

## Simulation Service

```ruby
# app/services/simulation_service.rb
class SimulationService < ApplicationService
  def initialize(current_user)
    super(current_user)
    ensure_user!
  end
  
  def run_simple_simulation(trade_id:, horizon_days: 7)
    trade = current_user.trades.find(trade_id)
    
    # Check cache first
    cache_key = "simulation:#{current_user.id}:#{trade_id}:#{horizon_days}"
    result = Rails.cache.read(cache_key)
    
    unless result
      # Enqueue simulation job
      job_id = SimulateSimpleJob.perform_later(
        user_id: current_user.id,
        trade_id: trade_id,
        horizon_days: horizon_days
      )
      
      return { status: 'pending', job_id: job_id }
    end
    
    result
  end
  
  def self.build_curves(trade:, ohlcv_data:)
    # Implementation for building hold-vs-actual curves
    # This would contain the business logic for simulations
  end
end
```

## Integration Services

### Market Data Adapter Service

```ruby
# app/services/market_data_adapter.rb
class MarketDataAdapter
  def self.fetch_ohlcv(symbol:, start_time:, end_time:)
    # Try broker data first
    broker_data = fetch_from_broker(symbol, start_time, end_time)
    return broker_data if broker_data.present?
    
    # Fallback to vendor data
    fetch_from_vendor(symbol, start_time, end_time)
  end
  
  private
  
  def self.fetch_from_broker(symbol, start_time, end_time)
    # Implementation for fetching from broker
  end
  
  def self.fetch_from_vendor(symbol, start_time, end_time)
    # Implementation for fetching from vendor
  end
end
```

### AI Client Service

```ruby
# app/services/ai_client.rb
class AIClient
  def self.calculate_indicators(ohlcv_data)
    # Make HTTP request to AI Coach service
    response = HTTP.post(
      "#{Rails.configuration.ai_coach_url}/v1/indicators",
      json: { series: ohlcv_data },
      headers: hmac_headers(ohlcv_data.to_json)
    )
    
    response.parse
  end
  
  def self.score_bias(trade_context, indicators)
    # Make HTTP request to AI Coach service
    response = HTTP.post(
      "#{Rails.configuration.ai_coach_url}/v1/bias/score",
      json: { trade: trade_context, indicators: indicators },
      headers: hmac_headers({ trade: trade_context, indicators: indicators }.to_json)
    )
    
    response.parse
  end
  
  def self.generate_reflection(bias_data)
    # Make HTTP request to AI Coach service
    response = HTTP.post(
      "#{Rails.configuration.ai_coach_url}/v1/nlg/reflect",
      json: bias_data,
      headers: hmac_headers(bias_data.to_json)
    )
    
    response.parse
  end
  
  private
  
  def self.hmac_headers(payload)
    timestamp = Time.current.iso8601
    signature = OpenSSL::HMAC.hexdigest(
      OpenSSL::Digest.new('sha256'),
      Rails.configuration.ai_coach_secret,
      timestamp + payload
    )
    
    {
      'X-KeyId' => Rails.configuration.ai_coach_key_id,
      'X-Timestamp' => timestamp,
      'X-Signature' => signature,
      'Content-Type' => 'application/json'
    }
  end
end
```

## Token Encryption Service

```ruby
# app/services/token_encryption_service.rb
class TokenEncryptionService
  def self.encrypt(token)
    # Implementation for encrypting tokens using AES-GCM
    # with per-record random nonce + key from KMS/encryption key
  end
  
  def self.decrypt(encrypted_token)
    # Implementation for decrypting tokens
  end
end
```

These service objects encapsulate the business logic of the application, making it easier to test and maintain. They follow the single responsibility principle and can be easily unit tested without requiring the full Rails stack.