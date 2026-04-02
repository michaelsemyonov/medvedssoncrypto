export const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS strategy_runs (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        strategy_key VARCHAR(128) NOT NULL,
        version VARCHAR(64) NOT NULL,
        timeframe VARCHAR(16) NOT NULL,
        status VARCHAR(32) NOT NULL,
        dry_run BOOLEAN NOT NULL,
        base_currency VARCHAR(16) NOT NULL,
        started_at DATETIME(3) NOT NULL,
        stopped_at DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id VARCHAR(36) PRIMARY KEY,
        exchange VARCHAR(32) NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        base_asset VARCHAR(16) NOT NULL,
        quote_asset VARCHAR(16) NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY symbols_exchange_symbol_unique (exchange, symbol)
      );

      CREATE TABLE IF NOT EXISTS market_candles (
        id VARCHAR(36) PRIMARY KEY,
        exchange VARCHAR(32) NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        timeframe VARCHAR(16) NOT NULL,
        open_time DATETIME(3) NOT NULL,
        close_time DATETIME(3) NOT NULL,
        open DOUBLE NOT NULL,
        high DOUBLE NOT NULL,
        low DOUBLE NOT NULL,
        close DOUBLE NOT NULL,
        volume DOUBLE NOT NULL,
        source VARCHAR(64) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY market_candles_unique (exchange, symbol, timeframe, close_time)
      );

      CREATE TABLE IF NOT EXISTS signals (
        id VARCHAR(36) PRIMARY KEY,
        strategy_run_id VARCHAR(36) NOT NULL,
        symbol_id VARCHAR(36) NOT NULL,
        exchange VARCHAR(32) NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        timeframe VARCHAR(16) NOT NULL,
        candle_close_time DATETIME(3) NOT NULL,
        signal_type VARCHAR(32) NOT NULL,
        signal_strength DOUBLE NULL,
        formula_inputs JSON NOT NULL,
        indicators JSON NOT NULL,
        features JSON NOT NULL,
        reason TEXT NOT NULL,
        approved BOOLEAN NULL,
        rejection_reason TEXT NULL,
        idempotency_key VARCHAR(191) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY signals_idempotency_key_unique (idempotency_key),
        CONSTRAINT fk_signals_run FOREIGN KEY (strategy_run_id) REFERENCES strategy_runs(id),
        CONSTRAINT fk_signals_symbol FOREIGN KEY (symbol_id) REFERENCES symbols(id)
      );

      CREATE TABLE IF NOT EXISTS risk_events (
        id VARCHAR(36) PRIMARY KEY,
        strategy_run_id VARCHAR(36) NOT NULL,
        signal_id VARCHAR(36) NOT NULL,
        symbol_id VARCHAR(36) NOT NULL,
        approved BOOLEAN NOT NULL,
        reason_code VARCHAR(64) NULL,
        reason_text TEXT NULL,
        snapshot JSON NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT fk_risk_events_run FOREIGN KEY (strategy_run_id) REFERENCES strategy_runs(id),
        CONSTRAINT fk_risk_events_signal FOREIGN KEY (signal_id) REFERENCES signals(id),
        CONSTRAINT fk_risk_events_symbol FOREIGN KEY (symbol_id) REFERENCES symbols(id)
      );

      CREATE TABLE IF NOT EXISTS positions (
        id VARCHAR(36) PRIMARY KEY,
        strategy_run_id VARCHAR(36) NOT NULL,
        symbol_id VARCHAR(36) NOT NULL,
        side VARCHAR(16) NOT NULL,
        status VARCHAR(16) NOT NULL,
        entry_time DATETIME(3) NOT NULL,
        exit_time DATETIME(3) NULL,
        entry_price DOUBLE NOT NULL,
        exit_price DOUBLE NULL,
        qty DOUBLE NOT NULL,
        notional_usdt DOUBLE NOT NULL,
        entry_fee DOUBLE NOT NULL,
        exit_fee DOUBLE NULL,
        realized_pnl DOUBLE NULL,
        opened_by_signal_id VARCHAR(36) NOT NULL,
        closed_by_signal_id VARCHAR(36) NULL,
        open_slot VARCHAR(96) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY positions_open_slot_unique (open_slot),
        CONSTRAINT fk_positions_run FOREIGN KEY (strategy_run_id) REFERENCES strategy_runs(id),
        CONSTRAINT fk_positions_symbol FOREIGN KEY (symbol_id) REFERENCES symbols(id),
        CONSTRAINT fk_positions_open_signal FOREIGN KEY (opened_by_signal_id) REFERENCES signals(id)
      );

      CREATE TABLE IF NOT EXISTS simulated_orders (
        id VARCHAR(36) PRIMARY KEY,
        strategy_run_id VARCHAR(36) NOT NULL,
        position_id VARCHAR(36) NULL,
        signal_id VARCHAR(36) NOT NULL,
        symbol_id VARCHAR(36) NOT NULL,
        order_type VARCHAR(16) NOT NULL,
        side VARCHAR(8) NOT NULL,
        intent VARCHAR(32) NOT NULL,
        reference_price DOUBLE NOT NULL,
        fill_price DOUBLE NULL,
        qty DOUBLE NOT NULL,
        notional_usdt DOUBLE NOT NULL,
        slippage_bps DOUBLE NOT NULL,
        fee_rate DOUBLE NOT NULL,
        fee_amount DOUBLE NOT NULL,
        fill_model VARCHAR(32) NOT NULL,
        status VARCHAR(16) NOT NULL,
        meta JSON NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY simulated_orders_signal_intent_unique (signal_id, intent),
        CONSTRAINT fk_simulated_orders_run FOREIGN KEY (strategy_run_id) REFERENCES strategy_runs(id),
        CONSTRAINT fk_simulated_orders_signal FOREIGN KEY (signal_id) REFERENCES signals(id),
        CONSTRAINT fk_simulated_orders_symbol FOREIGN KEY (symbol_id) REFERENCES symbols(id)
      );

      CREATE TABLE IF NOT EXISTS equity_snapshots (
        id VARCHAR(36) PRIMARY KEY,
        strategy_run_id VARCHAR(36) NOT NULL,
        snapshot_time DATETIME(3) NOT NULL,
        balance_usdt DOUBLE NOT NULL,
        equity_usdt DOUBLE NOT NULL,
        unrealized_pnl DOUBLE NOT NULL,
        realized_pnl_cum DOUBLE NOT NULL,
        drawdown_pct DOUBLE NOT NULL,
        open_positions INT NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        CONSTRAINT fk_equity_snapshots_run FOREIGN KEY (strategy_run_id) REFERENCES strategy_runs(id)
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id VARCHAR(36) PRIMARY KEY,
        user_label VARCHAR(255) NULL,
        endpoint VARCHAR(512) NOT NULL,
        p256dh VARCHAR(255) NOT NULL,
        auth VARCHAR(255) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        symbol_filters JSON NULL,
        event_filters JSON NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY push_subscriptions_endpoint_unique (endpoint)
      );
    `,
  },
  {
    id: '002_run_symbol_progress',
    sql: `
      CREATE TABLE IF NOT EXISTS run_symbol_progress (
        strategy_run_id VARCHAR(36) NOT NULL,
        symbol_id VARCHAR(36) NOT NULL,
        last_processed_close_time DATETIME(3) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (strategy_run_id, symbol_id),
        CONSTRAINT fk_run_symbol_progress_run FOREIGN KEY (strategy_run_id) REFERENCES strategy_runs(id),
        CONSTRAINT fk_run_symbol_progress_symbol FOREIGN KEY (symbol_id) REFERENCES symbols(id)
      );
    `,
  },
  {
    id: '002_simulated_orders_filled_at',
    sql: `
      ALTER TABLE simulated_orders
      ADD COLUMN filled_at DATETIME(3) NULL AFTER fill_price;

      UPDATE simulated_orders oo
      INNER JOIN positions p ON p.opened_by_signal_id = oo.signal_id
      SET oo.filled_at = p.entry_time
      WHERE oo.intent = 'OPEN_POSITION'
        AND oo.status = 'FILLED'
        AND oo.filled_at IS NULL;

      UPDATE simulated_orders oo
      INNER JOIN positions p ON p.id = oo.position_id
      SET oo.filled_at = p.exit_time
      WHERE oo.intent = 'CLOSE_POSITION'
        AND oo.status = 'FILLED'
        AND oo.filled_at IS NULL
        AND p.exit_time IS NOT NULL;
    `,
  },
  {
    id: '003_symbol_runtime_settings',
    sql: `
      ALTER TABLE symbols
      ADD COLUMN exchange_timeout_ms INT NOT NULL DEFAULT 10000 AFTER exchange,
      ADD COLUMN exchange_rate_limit_ms INT NOT NULL DEFAULT 300 AFTER exchange_timeout_ms,
      ADD COLUMN timeframe VARCHAR(16) NOT NULL DEFAULT '5m' AFTER quote_asset,
      ADD COLUMN dry_run BOOLEAN NOT NULL DEFAULT TRUE AFTER timeframe,
      ADD COLUMN allow_short BOOLEAN NOT NULL DEFAULT TRUE AFTER dry_run,
      ADD COLUMN strategy_key VARCHAR(128) NOT NULL DEFAULT 'momentum_96_5_72' AFTER allow_short,
      ADD COLUMN strategy_version VARCHAR(64) NOT NULL DEFAULT '1.0.0' AFTER strategy_key,
      ADD COLUMN signal_n INT NOT NULL DEFAULT 96 AFTER strategy_version,
      ADD COLUMN signal_k INT NOT NULL DEFAULT 5 AFTER signal_n,
      ADD COLUMN signal_h_bars INT NOT NULL DEFAULT 72 AFTER signal_k,
      ADD COLUMN fill_model VARCHAR(32) NOT NULL DEFAULT 'next_open' AFTER signal_h_bars,
      ADD COLUMN fee_rate DOUBLE NOT NULL DEFAULT 0.001 AFTER fill_model,
      ADD COLUMN slippage_bps DOUBLE NOT NULL DEFAULT 5 AFTER fee_rate,
      ADD COLUMN position_sizing_mode VARCHAR(32) NOT NULL DEFAULT 'fixed_usdt' AFTER slippage_bps,
      ADD COLUMN fixed_usdt_per_trade DOUBLE NOT NULL DEFAULT 100 AFTER position_sizing_mode,
      ADD COLUMN equity_start_usdt DOUBLE NOT NULL DEFAULT 10000 AFTER fixed_usdt_per_trade,
      ADD COLUMN max_open_positions INT NOT NULL DEFAULT 5 AFTER equity_start_usdt,
      ADD COLUMN cooldown_bars INT NOT NULL DEFAULT 3 AFTER max_open_positions,
      ADD COLUMN max_daily_drawdown_pct DOUBLE NOT NULL DEFAULT 5 AFTER cooldown_bars,
      ADD COLUMN max_consecutive_losses INT NOT NULL DEFAULT 5 AFTER max_daily_drawdown_pct,
      ADD COLUMN poll_interval_ms INT NOT NULL DEFAULT 15000 AFTER max_consecutive_losses;
    `,
  },
  {
    id: '004_backfill_simulated_order_fill_times',
    sql: `
      UPDATE simulated_orders oo
      INNER JOIN positions p ON p.opened_by_signal_id = oo.signal_id
      SET oo.filled_at = p.entry_time
      WHERE oo.intent = 'OPEN_POSITION'
        AND oo.status = 'FILLED'
        AND p.entry_time IS NOT NULL
        AND (oo.filled_at IS NULL OR oo.filled_at <> p.entry_time);

      UPDATE simulated_orders oo
      INNER JOIN positions p ON p.closed_by_signal_id = oo.signal_id
      SET oo.filled_at = p.exit_time
      WHERE oo.intent = 'CLOSE_POSITION'
        AND oo.status = 'FILLED'
        AND p.exit_time IS NOT NULL
        AND (oo.filled_at IS NULL OR oo.filled_at <> p.exit_time);
    `,
  },
  {
    id: '005_stop_loss_and_brokers',
    sql: `
      ALTER TABLE symbols
      ADD COLUMN position_broker VARCHAR(32) NOT NULL DEFAULT 'bybit' AFTER exchange_rate_limit_ms,
      ADD COLUMN counter_position_broker VARCHAR(32) NOT NULL DEFAULT 'okx' AFTER position_broker,
      ADD COLUMN stop_loss_pct DOUBLE NOT NULL DEFAULT 2 AFTER cooldown_bars;

      ALTER TABLE positions
      ADD COLUMN broker VARCHAR(32) NOT NULL DEFAULT 'bybit' AFTER symbol_id,
      ADD COLUMN is_counter_position BOOLEAN NOT NULL DEFAULT FALSE AFTER broker;

      ALTER TABLE simulated_orders
      ADD COLUMN broker VARCHAR(32) NOT NULL DEFAULT 'bybit' AFTER symbol_id;
    `,
  },
  {
    id: '006_trailing_profit_settings',
    sql: `
      ALTER TABLE symbols
      ADD COLUMN trailing_profile VARCHAR(32) NOT NULL DEFAULT 'balanced' AFTER stop_loss_pct,
      ADD COLUMN trailing_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER trailing_profile,
      ADD COLUMN trailing_activation_profit_pct DOUBLE NOT NULL DEFAULT 1.2 AFTER trailing_enabled,
      ADD COLUMN trailing_giveback_ratio DOUBLE NOT NULL DEFAULT 0.35 AFTER trailing_activation_profit_pct,
      ADD COLUMN trailing_giveback_min_pct DOUBLE NOT NULL DEFAULT 0.4 AFTER trailing_giveback_ratio,
      ADD COLUMN trailing_giveback_max_pct DOUBLE NOT NULL DEFAULT 1.5 AFTER trailing_giveback_min_pct,
      ADD COLUMN trailing_min_locked_profit_pct DOUBLE NOT NULL DEFAULT 0.4 AFTER trailing_giveback_max_pct;
    `,
  },
  {
    id: '007_exchange_accounts_and_positions',
    sql: `
      CREATE TABLE IF NOT EXISTS exchange_accounts (
        exchange VARCHAR(32) PRIMARY KEY,
        api_key_ciphertext TEXT NULL,
        api_secret_ciphertext TEXT NULL,
        api_passphrase_ciphertext TEXT NULL,
        api_key_mask VARCHAR(64) NULL,
        has_api_key BOOLEAN NOT NULL DEFAULT FALSE,
        has_api_secret BOOLEAN NOT NULL DEFAULT FALSE,
        has_api_passphrase BOOLEAN NOT NULL DEFAULT FALSE,
        last_validated_at DATETIME(3) NULL,
        last_sync_at DATETIME(3) NULL,
        last_sync_error TEXT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
      );

      CREATE TABLE IF NOT EXISTS exchange_positions (
        id VARCHAR(36) PRIMARY KEY,
        exchange VARCHAR(32) NOT NULL,
        external_position_id VARCHAR(128) NOT NULL,
        instrument_id VARCHAR(64) NOT NULL,
        symbol VARCHAR(32) NOT NULL,
        side VARCHAR(16) NOT NULL,
        status VARCHAR(16) NOT NULL,
        qty DOUBLE NOT NULL,
        entry_price DOUBLE NOT NULL,
        mark_price DOUBLE NULL,
        notional_usdt DOUBLE NOT NULL,
        unrealized_pnl DOUBLE NULL,
        stop_loss_price DOUBLE NULL,
        linked_position_id VARCHAR(36) NULL,
        opened_at DATETIME(3) NULL,
        synced_at DATETIME(3) NOT NULL,
        meta JSON NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY exchange_positions_unique (exchange, external_position_id),
        KEY exchange_positions_status_idx (exchange, status, symbol)
      );
    `,
  },
];
