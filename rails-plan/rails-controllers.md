# Rails Controllers and API Endpoints

This document outlines how the Rails controllers would be structured to match the existing API endpoints.

## API Versioning

Controllers would be organized under an API version namespace:

```
app/controllers/api/v1/
```

## Base API Controller

```ruby
# app/controllers/api/v1/base_controller.rb
class Api::V1::BaseController < ApplicationController
  protect_from_forgery with: :null_session
  before_action :authenticate_request
  
  private
  
  def authenticate_request
    # JWT authentication logic
    # Sets @current_user
  end
  
  def current_user
    @current_user
  end
end
```

## Authentication Controller

```ruby
# app/controllers/api/v1/auth_controller.rb
class Api::V1::AuthController < Api::V1::BaseController
  skip_before_action :authenticate_request, only: [:signup, :login]
  
  def signup
    user = User.new(user_params)
    if user.save
      token = AuthToken.issue_token(user)
      render json: { jwt: token, exp: 24.hours.from_now }, status: :created
    else
      render json: { errors: user.errors }, status: :unprocessable_entity
    end
  end
  
  def login
    user = User.find_by(email: params[:email])
    if user && user.authenticate(params[:password])
      token = AuthToken.issue_token(user)
      Session.create!(user: user, expires_at: 24.hours.from_now)
      render json: { jwt: token, exp: 24.hours.from_now }
    else
      render json: { error: 'Invalid credentials' }, status: :unauthorized
    end
  end
  
  def logout
    # Invalidate session
    session = Session.find_by(id: request.headers['X-Session-ID'])
    session&.destroy
    render json: { message: 'Logged out successfully' }
  end
  
  private
  
  def user_params
    params.require(:user).permit(:email, :password)
  end
end
```

## Brokers Controller

```ruby
# app/controllers/api/v1/brokers_controller.rb
class Api::V1::BrokersController < Api::V1::BaseController
  def connect_callback
    # Handle OAuth callback from broker
    broker_service = BrokerService.new(current_user)
    result = broker_service.handle_oauth_callback(params)
    
    if result.success?
      render json: { ok: true }
    else
      render json: { error: result.error }, status: :bad_request
    end
  end
  
  def connections
    connections = current_user.broker_connections
    render json: connections
  end
end
```

## Trades Controller

```ruby
# app/controllers/api/v1/trades_controller.rb
class Api::V1::TradesController < Api::V1::BaseController
  before_action :check_idempotency_key, only: [:import]
  
  def import
    # Enqueue import job
    job_id = ImportTradesJob.perform_later(
      user_id: current_user.id,
      since_iso: params[:since],
      broker: params[:broker]
    )
    
    render json: { job_id: job_id }, status: :accepted
  end
  
  def index
    trades = current_user.trades
      .order(ts: :desc)
      .limit(params[:limit] || 50)
    
    render json: trades
  end
  
  def show
    trade = current_user.trades.find(params[:id])
    render json: trade
  end
  
  private
  
  def check_idempotency_key
    # Implementation for idempotency check
    # Return early if same request was already processed
  end
end
```

## Bias Tags Controller

```ruby
# app/controllers/api/v1/bias_tags_controller.rb
class Api::V1::BiasTagsController < Api::V1::BaseController
  def index
    trade = current_user.trades.find(params[:trade_id])
    bias_tags = trade.bias_tags
    render json: bias_tags
  end
end
```

## Rules Controller

```ruby
# app/controllers/api/v1/rules_controller.rb
class Api::V1::RulesController < Api::V1::BaseController
  def index
    rules = current_user.rules
    render json: rules
  end
  
  def upsert
    rule = current_user.rules.find_or_initialize_by(kind: params[:kind])
    if rule.update(rule_params)
      render json: rule
    else
      render json: { errors: rule.errors }, status: :unprocessable_entity
    end
  end
  
  private
  
  def rule_params
    params.require(:rule).permit(:kind, :params, :active)
  end
end
```

## Digests Controller

```ruby
# app/controllers/api/v1/digests_controller.rb
class Api::V1::DigestsController < Api::V1::BaseController
  def latest
    digest = current_user.digests.order(created_at: :desc).first
    if digest
      render json: digest
    else
      render json: { error: 'No digest found' }, status: :not_found
    end
  end
end
```

## Events Controller

```ruby
# app/controllers/api/v1/events_controller.rb
class Api::V1::EventsController < Api::V1::BaseController
  def index
    # Replay events since eventId
    events = EventOutbox
      .where(user: current_user)
      .where('id > ?', params[:since])
      .order(:id)
      .limit(500)
    
    render json: events
  end
  
  def subscribe
    # SSE endpoint for live events
    response.headers['Content-Type'] = 'text/event-stream'
    response.headers['X-Accel-Buffering'] = 'no'
    
    sse = SSE.new(response.stream)
    begin
      # Subscribe to Redis pub/sub or use ActionController::Live
      EventService.subscribe_to_user_events(current_user.id) do |event|
        sse.write(event, event: 'message')
      end
    rescue ClientDisconnected
      # Client disconnected
    ensure
      sse.close
    end
  end
end
```

## Simulations Controller

```ruby
# app/controllers/api/v1/simulations_controller.rb
class Api::V1::SimulationsController < Api::V1::BaseController
  def simple
    # Compute/retrieve simple what-if simulation
    trade = current_user.trades.find(params[:trade_id])
    horizon_days = params[:horizon_days] || 7
    
    # Check cache first
    cache_key = "simulation:#{current_user.id}:#{trade.id}:#{horizon_days}"
    result = Rails.cache.read(cache_key)
    
    unless result
      # Enqueue simulation job if not in cache
      SimulateSimpleJob.perform_later(
        user_id: current_user.id,
        trade_id: trade.id,
        horizon_days: horizon_days
      )
      
      # Return a pending status
      render json: { status: 'pending' }, status: :accepted
      return
    end
    
    render json: result
  end
end
```

## Routes Configuration

```ruby
# config/routes.rb
Rails.application.routes.draw do
  namespace :api do
    namespace :v1 do
      # Auth endpoints
      post '/auth/signup', to: 'auth#signup'
      post '/auth/login', to: 'auth#login'
      post '/auth/logout', to: 'auth#logout'
      
      # Broker endpoints
      get '/brokers/:broker/connect/callback', to: 'brokers#connect_callback'
      
      # Trades endpoints
      post '/trades/import', to: 'trades#import'
      get '/trades', to: 'trades#index'
      get '/trades/:id', to: 'trades#show'
      
      # Bias tags endpoints
      get '/trades/:trade_id/bias', to: 'bias_tags#index'
      
      # Rules endpoints
      get '/rules', to: 'rules#index'
      post '/rules/upsert', to: 'rules#upsert'
      
      # Digests endpoints
      get '/digests/weekly/latest', to: 'digests#latest'
      
      # Events endpoints
      get '/events', to: 'events#index'
      get '/events/subscribe', to: 'events#subscribe'
      
      # Simulations endpoints
      post '/simulations/simple', to: 'simulations#simple'
    end
  end
end