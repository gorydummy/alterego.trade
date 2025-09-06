# Rails Background Jobs with ActiveJob and Sidekiq

This document describes how background jobs would be implemented in Rails using ActiveJob with Sidekiq to replace the existing BullMQ workers.

## Configuration

```ruby
# config/application.rb
config.active_job.queue_adapter = :sidekiq
```

```yaml
# config/sidekiq.yml
:concurrency: 5
:queues:
  - import_trades
  - score_bias
  - simulate_simple
  - generate_digest
```

## Job Base Class

```ruby
# app/jobs/application_job.rb
class ApplicationJob < ActiveJob::Base
  # Automatically retry jobs that encountered a deadlock
  retry_on ActiveRecord::Deadlocked

  # Most jobs are safe to ignore if the underlying records are no longer available
  discard_on ActiveJob::DeserializationError
  
  # Add logging and monitoring
  around_perform do |job, block|
    Rails.logger.info "Starting job: #{job.class.name}"
    start_time = Time.current
    block.call
    end_time = Time.current
    Rails.logger.info "Completed job: #{job.class.name} in #{(end_time - start_time) * 1000}ms"
  end
end
```

## Import Trades Job

```ruby
# app/jobs/import_trades_job.rb
class ImportTradesJob < ApplicationJob
  queue_as :import_trades
  
  def perform(user_id, since_iso, broker = nil)
    user = User.find(user_id)
    broker_connection = user.broker_connections.active.first
    
    return unless broker_connection
    
    adapter = BrokerAdapterFactory.for(broker_connection.broker)
    
    cursor = nil
    stored_total = 0
    fetched_total = 0
    
    loop do
      page = adapter.fetch_trades(
        access_token: broker_connection.access_token,
        since_iso: since_iso,
        cursor: cursor
      )
      
      fetched_total += page[:trades].length
      
      normalized_trades = page[:trades].map do |trade|
        normalize_trade(trade, user_id, broker_connection.broker)
      end
      
      stored = Trade.import_many(user_id, normalized_trades)
      stored_total += stored
      
      # Emit progress event
      EventOutbox.create!(
        user: user,
        type: 'import.progress',
        payload: {
          job_id: job_id,
          percent: page[:percent],
          fetched: fetched_total,
          stored: stored_total
        }
      )
      
      cursor = page[:next_cursor]
      break unless cursor
      
      # Respect rate limits
      sleep(page[:rate_limit_delay]) if page[:rate_limit_delay]
    end
    
    # Enqueue scoring for this window
    ScoreBiasJob.perform_later(user_id, since_iso)
  end
  
  private
  
  def normalize_trade(trade_data, user_id, broker)
    {
      user_id: user_id,
      broker: broker,
      ext_id: trade_data[:id],
      symbol: trade_data[:symbol],
      side: trade_data[:side],
      qty: trade_data[:quantity],
      price: trade_data[:price],
      fee: trade_data[:fee],
      ts: trade_data[:timestamp]
    }
  end
end
```

## Score Bias Job

```ruby
# app/jobs/score_bias_job.rb
class ScoreBiasJob < ApplicationJob
  queue_as :score_bias
  
  def perform(user_id, since_iso)
    user = User.find(user_id)
    trades = user.trades.where('ts >= ?', since_iso)
    
    trades.find_each(batch_size: 100) do |trade|
      # Get OHLCV data for trade
      ohlcv_data = MarketDataAdapter.fetch_ohlcv(
        symbol: trade.symbol,
        timestamp: trade.ts
      )
      
      # Calculate indicators using AI Coach
      indicators = AIClient.calculate_indicators(ohlcv_data)
      
      # Apply heuristics
      bias_result = BiasHeuristicService.score(
        trade: trade,
        indicators: indicators
      )
      
      # Persist BiasTag
      BiasTag.find_or_create_by!(
        trade: trade,
        label: bias_result[:label]
      ) do |bias_tag|
        bias_tag.confidence = bias_result[:confidence]
        bias_tag.features = bias_result[:features]
      end
      
      # Emit coach.reflect event
      EventOutbox.create!(
        user: user,
        type: 'coach.reflect',
        payload: {
          trade_id: trade.id,
          labels: [{
            name: bias_result[:label],
            confidence: bias_result[:confidence]
          }],
          insight: bias_result[:insight],
          tone: 'supportive'
        }
      )
    end
  end
end
```

## Simulate Simple Job

```ruby
# app/jobs/simulate_simple_job.rb
class SimulateSimpleJob < ApplicationJob
  queue_as :simulate_simple
  
  def perform(user_id, trade_id, horizon_days)
    user = User.find(user_id)
    trade = user.trades.find(trade_id)
    
    # Check cache first
    cache_key = "simulation:#{user_id}:#{trade_id}:#{horizon_days}"
    cached_result = Rails.cache.read(cache_key)
    
    return cached_result if cached_result
    
    # Fetch OHLCV data
    ohlcv_data = MarketDataAdapter.fetch_ohlcv(
      symbol: trade.symbol,
      start_time: trade.ts,
      end_time: horizon_days.days.from_now
    )
    
    # Build curves
    simulation_result = SimulationService.build_curves(
      trade: trade,
      ohlcv_data: ohlcv_data
    )
    
    # Cache the result
    Rails.cache.write(cache_key, simulation_result, expires_in: 1.hour)
    
    # Store result
    SimulationResult.find_or_create_by!(
      user: user,
      trade: trade,
      horizon_days: horizon_days
    ) do |result|
      result.delta_pnl = simulation_result[:delta_pnl]
      result.params = simulation_result[:params]
    end
  end
end
```

## Generate Digest Job

```ruby
# app/jobs/generate_digest_job.rb
class GenerateDigestJob < ApplicationJob
  queue_as :generate_digest
  
  def perform(user_id, period_start, period_end)
    user = User.find(user_id)
    
    # Load data for the window
    trades = user.trades
      .where(ts: period_start..period_end)
      .includes(:bias_tags)
    
    # Aggregate statistics
    stats = DigestAggregationService.aggregate(trades)
    
    # Generate snapshot
    snapshot_url = DigestStorageService.store_snapshot(
      user_id: user_id,
      period_start: period_start,
      period_end: period_end,
      data: stats
    )
    
    # Upsert digest
    digest = Digest.find_or_initialize_by(
      user: user,
      period_start: period_start,
      period_end: period_end
    )
    
    digest.payload = stats
    digest.url = snapshot_url
    digest.save!
    
    # Emit digest.ready event
    EventOutbox.create!(
      user: user,
      type: 'digest.ready',
      payload: {
        digest_id: digest.id,
        period: {
          start: period_start,
          end: period_end
        }
      }
    )
  end
end
```

## Job Scheduling

```ruby
# app/services/job_scheduling_service.rb
class JobSchedulingService
  def self.schedule_weekly_digest(user_id)
    # Schedule digest job for the previous week
    period_end = Date.current.beginning_of_week
    period_start = period_end - 7.days
    
    GenerateDigestJob.set(
      wait_until: period_end.beginning_of_week + 1.day # Run on Monday
    ).perform_later(user_id, period_start, period_end)
  end
  
  def self.schedule_import_and_scoring(user_id)
    # Schedule import and scoring for the last 30 days
    since_iso = 30.days.ago.iso8601
    
    ImportTradesJob.perform_later(user_id, since_iso)
    # Scoring will be triggered automatically after import
  end
end
```

## Job Monitoring and Error Handling

```ruby
# config/initializers/sidekiq.rb
Sidekiq.configure_server do |config|
  config.death_handlers << ->(job, ex) do
    # Handle permanently failed jobs
    Rails.logger.error "Job permanently failed: #{job['class']} with error: #{ex.message}"
    # Send to error tracking service
  end
  
  config.on(:startup) do
    # Perform any initialization
  end
  
  config.on(:quiet) do
    # Prepare for shutdown
  end
  
  config.on(:shutdown) do
    # Cleanup
  end
end
```

## Job Retry Policies

```ruby
# app/jobs/import_trades_job.rb (additional configuration)
class ImportTradesJob < ApplicationJob
  queue_as :import_trades
  
  # Retry with exponential backoff
  retry_on StandardError, wait: :exponentially_longer, attempts: 5
  
  # Handle specific errors differently
  retry_on NetworkError, wait: 5.seconds, attempts: 3
  discard_on ActiveRecord::RecordNotFound
  
  # ... rest of the job implementation
end
```

This implementation provides a robust background job system using Rails' ActiveJob with Sidekiq as the backend, which would replace the existing BullMQ implementation while maintaining the same functionality and job contracts.