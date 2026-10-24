CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS tenants(id uuid PRIMARY KEY, name text NOT NULL, version integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS branches(
  tenant_id uuid NOT NULL REFERENCES tenants(id), id uuid NOT NULL, name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS accounts(
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id), branch_id uuid NOT NULL,
  email text UNIQUE, name text NOT NULL, password_hash text, role text NOT NULL,
  customer_id uuid, mfa_secret text, adult boolean NOT NULL DEFAULT false,
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id), csrf text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  last_seen timestamptz NOT NULL DEFAULT now(), elevated boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS otp_challenges(
  id uuid PRIMARY KEY, phone_hash text NOT NULL, phone text NOT NULL, code_hash text NOT NULL,
  expires_at timestamptz NOT NULL, attempts integer NOT NULL DEFAULT 0, consumed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS customers(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, name text NOT NULL,
  phone text NOT NULL, data jsonb NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id), UNIQUE(tenant_id,phone)
);
CREATE TABLE IF NOT EXISTS services(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, name text NOT NULL,
  category text NOT NULL, price_minor bigint NOT NULL CHECK(price_minor>=0),
  duration integer NOT NULL CHECK(duration BETWEEN 5 AND 480), data jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1,
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS professionals(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, name text NOT NULL,
  title text NOT NULL, data jsonb NOT NULL, active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS assets(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('professional','resource','recipient')), name text NOT NULL,
  resource_type text, PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS quotes(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, actor_id uuid,
  customer_id uuid, fingerprint text NOT NULL, plan jsonb NOT NULL, total_minor bigint NOT NULL,
  expires_at timestamptz NOT NULL, PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS bookings(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, customer_id uuid NOT NULL,
  reference text NOT NULL, source text NOT NULL, status text NOT NULL,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, total_minor bigint NOT NULL CHECK(total_minor>=0),
  plan jsonb NOT NULL, policy jsonb NOT NULL DEFAULT '{}', hold_expires_at timestamptz,
  pass_hash text, pass_token text, pass_version integer NOT NULL DEFAULT 1,
  arrived_at timestamptz, visit_status text, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,reference),
  FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id),
  FOREIGN KEY(tenant_id,customer_id) REFERENCES customers(tenant_id,id), CHECK(ends_at>starts_at)
);
CREATE TABLE IF NOT EXISTS reservations(
  tenant_id uuid NOT NULL, id uuid NOT NULL, branch_id uuid NOT NULL, asset_id uuid NOT NULL,
  booking_id uuid NOT NULL, period tstzrange NOT NULL, active boolean NOT NULL DEFAULT true,
  kind text NOT NULL CHECK(kind IN ('hold','confirmed','block')), PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id),
  FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id),
  CHECK(NOT isempty(period) AND NOT lower_inf(period) AND NOT upper_inf(period) AND lower_inc(period) AND NOT upper_inc(period)),
  EXCLUDE USING gist(tenant_id WITH =,asset_id WITH =,period WITH &&) WHERE(active)
);
CREATE TABLE IF NOT EXISTS steps(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, booking_id uuid NOT NULL,
  sequence integer NOT NULL, state text NOT NULL DEFAULT 'PLANNED', data jsonb NOT NULL,
  called_until timestamptz, actual_start timestamptz, actual_end timestamptz, delay_minutes integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id), UNIQUE(tenant_id,booking_id,sequence)
);
CREATE TABLE IF NOT EXISTS occupancies(
  tenant_id uuid NOT NULL, id uuid NOT NULL, asset_id uuid NOT NULL, step_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id), FOREIGN KEY(tenant_id,step_id) REFERENCES steps(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_occupancy ON occupancies(tenant_id,asset_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS invoices(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, booking_id uuid NOT NULL,
  number text NOT NULL, total_minor bigint NOT NULL CHECK(total_minor>=0), snapshot jsonb NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,booking_id),
  FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS payments(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, invoice_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0), tender text NOT NULL CHECK(tender IN ('cash','bank_verified')),
  evidence text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS refunds(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, payment_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,payment_id) REFERENCES payments(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS ledger_entries(
  tenant_id uuid NOT NULL, id uuid NOT NULL, transaction_id uuid NOT NULL, account text NOT NULL,
  amount_minor bigint NOT NULL, currency text NOT NULL DEFAULT 'PKR', created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id)
);
CREATE OR REPLACE FUNCTION check_ledger_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COALESCE(SUM(amount_minor),0) FROM ledger_entries WHERE tenant_id=NEW.tenant_id AND transaction_id=NEW.transaction_id AND currency=NEW.currency) <> 0 THEN
    RAISE EXCEPTION 'Unbalanced ledger transaction';
  END IF;
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='ledger_balance') THEN
    CREATE CONSTRAINT TRIGGER ledger_balance AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_ledger_balance();
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS receipts(
  tenant_id uuid NOT NULL, id uuid NOT NULL, invoice_id uuid NOT NULL, payment_id uuid NOT NULL,
  snapshot jsonb NOT NULL, checksum text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,invoice_id) REFERENCES invoices(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS products(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, name text NOT NULL,
  category text NOT NULL, unit text NOT NULL, on_hand integer NOT NULL CHECK(on_hand>=0),
  reorder_at integer NOT NULL CHECK(reorder_at>=0), price_minor bigint NOT NULL,
  version integer NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,branch_id) REFERENCES branches(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS stock_movements(
  tenant_id uuid NOT NULL, id uuid NOT NULL, product_id uuid NOT NULL, delta integer NOT NULL,
  reason text NOT NULL, actor_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,product_id) REFERENCES products(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS command_results(
  tenant_id uuid NOT NULL, actor_id uuid NOT NULL, operation text NOT NULL, key text NOT NULL,
  request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,actor_id,operation,key)
);
CREATE TABLE IF NOT EXISTS audit_events(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, actor_id uuid NOT NULL,
  action text NOT NULL, target_id text, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS outbox_events(
  sequence bigserial UNIQUE, tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL,
  type text NOT NULL, target_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE IF NOT EXISTS cash_sessions(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, opening_minor bigint NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, counted_minor bigint,
  expected_minor bigint, actor_id uuid NOT NULL, PRIMARY KEY(tenant_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_register ON cash_sessions(tenant_id,branch_id) WHERE closed_at IS NULL;
CREATE TABLE IF NOT EXISTS ai_jobs(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, actor_id uuid NOT NULL,
  kind text NOT NULL, status text NOT NULL DEFAULT 'pending', result jsonb, model text,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS request jsonb;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS scheduled_jobs(
  tenant_id uuid NOT NULL, branch_id uuid NOT NULL, id uuid NOT NULL, booking_id uuid NOT NULL,
  booking_version integer NOT NULL, kind text NOT NULL, run_after timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending', provider_reference text, detail text,
  lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,booking_id,booking_version,kind),
  FOREIGN KEY(tenant_id,booking_id) REFERENCES bookings(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS due_jobs ON scheduled_jobs(tenant_id,status,run_after);
CREATE INDEX IF NOT EXISTS booking_calendar ON bookings(tenant_id,branch_id,starts_at);
CREATE INDEX IF NOT EXISTS event_replay ON outbox_events(tenant_id,branch_id,sequence);
CREATE OR REPLACE FUNCTION prevent_fact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Posted financial and audit facts are immutable'; END $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['receipts','payments','refunds','ledger_entries','audit_events','stock_movements','invoices'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname=tab||'_immutable') THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_fact_mutation()', tab||'_immutable',tab);
    END IF;
  END LOOP;
END $$;
-- A dedicated runtime role is scoped by SET LOCAL in every domain transaction.
-- Migration/identity access remains an explicitly separate boundary.
DO $$ DECLARE tab text; BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='aurelle_app') THEN
    CREATE ROLE aurelle_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  FOREACH tab IN ARRAY ARRAY['customers','quotes','bookings','reservations','steps','occupancies','invoices','payments','refunds','ledger_entries','receipts','products','stock_movements','command_results','audit_events','outbox_events','cash_sessions','ai_jobs','assets','scheduled_jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=tab AND policyname='tenant_scope') THEN
      EXECUTE format('CREATE POLICY tenant_scope ON %I USING (tenant_id::text=current_setting(''app.tenant_id'',true)) WITH CHECK (tenant_id::text=current_setting(''app.tenant_id'',true))',tab);
    END IF;
  END LOOP;
  GRANT USAGE ON SCHEMA public TO aurelle_app;
  GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO aurelle_app;
  GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO aurelle_app;
END $$;
