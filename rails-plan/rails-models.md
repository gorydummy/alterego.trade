# Rails Models Implementation

This document details how the existing data entities would be implemented as Rails models.

## Gem Dependencies

```ruby
# Gemfile additions for key functionality
gem 'nanoid' # For ID generation
gem 'sidekiq' # Background jobs
gem 'jwt' # JWT token handling
gem 'bcrypt' # Password hashing
gem 'redis' # Redis integration
```

## Model Structure

### User Model

```ruby
# app/models/user.rb
class User < ApplicationRecord
  has_secure_password
  
  has_many :sessions, dependent: :destroy
  has_many :broker_connections, dependent: :destroy
  has_many :trades, dependent: :destroy
  has_many :bias_tags, through: :trades
  has_many :digests, dependent: :destroy
  has_many :rules, dependent: :destroy
  has_many :audits, dependent: :destroy
  
  validates :email, presence: true, uniqueness: true
  
  before_create :generate_nanoid
  
  private
  
  def generate_nanoid
    self.id = Nanoid.generate(size: 21) unless id.present?
  end
end
```

### Session Model

```ruby
# app/models/session.rb
class Session < ApplicationRecord
  belongs_to :user
  
  validates :expires_at, presence: true
  
  before_create :generate_nanoid
  
  private
  
  def generate_nanoid
    self.id = Nanoid.generate(size: 21) unless id.present?
  end
end
```

### BrokerConnection Model

```ruby
# app/models/broker_connection.rb
class BrokerConnection < ApplicationRecord
  belongs_to :user
  
  validates :broker, :status, presence: true
  
  before_create :generate_nanoid
  
  private
  
  def generate_nanoid
    self.id = Nanoid.generate(size: 21) unless id.present?
  end
end
```

### Trade Model

```ruby
# app/models/trade.rb
class Trade < ApplicationRecord
  belongs_to :user
  has_many :bias_tags, dependent: :destroy
  
  validates :broker, :ext_id, :symbol, :side, :qty, :price, :ts, presence: true
  validates :side, inclusion: { in: %w[BUY SELL] }
  
  before_create :generate_nanoid
  
  private
  
  def generate_nanoid
    self.id = Nanoid.generate(size: 21) unless id.present?
  end
end
```

### BiasTag Model

```ruby
# app/models/bias_tag.rb
class BiasTag < ApplicationRecord
  belongs_to :trade
  
  validates :label, :confidence, :features, presence: true
  validates :label, inclusion: { in: %w[FOMO PANIC DISCIPLINE NEUTRAL] }
  validates :confidence, numericality: { greater_than_or_equal_to: 0, less_than_or_equal_to: 1 }
  
  before_create :generate_nanoid
  
  private
  
  def generate_nanoid
    self.id = Nanoid.generate(size: 21) unless id.present?
  end
end
```

### Rule Model

```ruby
# app/models/rule.rb
class Rule < ApplicationRecord
  belongs_to :user
  
  validates :kind, :params, presence: true
  
  before_create :generate_nanoid
  
  private
  
  def generate_nanoid
    self.id = Nanoid.generate(size: 21) unless id.present?
  end
end
```

### Digest Model

```ruby
# app/models/digest.rb
class Digest < ApplicationRecord
  belongs_to :user
  
  validates :period_start, :period_end, :payload, presence: true
  
  before_create :generate_nanoid
  
  private
  
  def generate_nanoid
    self.id = Nanoid.generate(size: 21) unless id.present?
  end
end
```

### Audit Model

```ruby
# app/models/audit.rb
class Audit < ApplicationRecord
  belongs_to :user
  
  validates :action, :meta, presence: true
  
  before_create :generate_nanoid
  
  private
  
  def generate_nanoid
    self.id = Nanoid.generate(size: 21) unless id.present?
  end
end
```

### EventOutbox Model

```ruby
# app/models/event_outbox.rb
class EventOutbox < ApplicationRecord
  belongs_to :user
  
  validates :type, :payload, presence: true
  
  # Note: EventOutbox uses ULID instead of nanoid
  before_create :generate_ulid
  
  private
  
  def generate_ulid
    # ULID generation would be implemented here
    # This is just a placeholder
    self.id = SecureRandom.uuid unless id.present?
  end
end
```

## Database Migration Example

```ruby
# db/migrate/xxx_create_users.rb
class CreateUsers < ActiveRecord::Migration[7.0]
  def change
    create_table :users, id: false do |t|
      t.string :id, null: false, primary_key: true
      t.string :email, null: false
      t.string :password_hash
      t.timestamps
    end
    
    add_index :users, :email, unique: true
  end
end
```

```ruby
# db/migrate/xxx_create_trades.rb
class CreateTrades < ActiveRecord::Migration[7.0]
  def change
    create_table :trades, id: false do |t|
      t.string :id, null: false, primary_key: true
      t.string :user_id, null: false
      t.string :broker, null: false
      t.string :ext_id, null: false
      t.string :symbol, null: false
      t.string :side, null: false
      t.decimal :qty, precision: 15, scale: 8, null: false
      t.decimal :price, precision: 15, scale: 8, null: false
      t.decimal :fee, precision: 15, scale: 8
      t.datetime :ts, null: false
      t.timestamps
    end
    
    add_index :trades, :user_id
    add_index :trades, :symbol
    add_index :trades, :ts
    add_index :trades, [:user_id, :broker, :ext_id], unique: true, name: 'unique_trade_user_extid'
  end
end
```

## Model Concerns

### NanoidGenerator Concern

```ruby
# app/models/concerns/nanoid_generator.rb
module NanoidGenerator
  extend ActiveSupport::Concern
  
  included do
    before_create :generate_nanoid
  end
  
  private
  
  def generate_nanoid
    self.id = Nanoid.generate(size: 21) unless id.present?
  end
end
```

Then include in models:

```ruby
class User < ApplicationRecord
  include NanoidGenerator
  # ... rest of the model
end
```

This approach centralizes the ID generation logic and makes it easy to maintain consistency across all models that require nanoid IDs.