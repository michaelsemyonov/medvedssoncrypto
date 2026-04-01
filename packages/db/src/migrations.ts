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
];
