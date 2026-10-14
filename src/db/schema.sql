-- MedLab database schema (PostgreSQL 16)
-- Owner: backend. Safe to run repeatedly (idempotent).

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  role            TEXT        NOT NULL CHECK (role IN ('physician','lab_admin','technician','patient')),
  date_of_birth   DATE,
  is_on_call      BOOLEAN     NOT NULL DEFAULT FALSE,   -- physician on the escalation rota
  is_lab_director BOOLEAN     NOT NULL DEFAULT FALSE,   -- final escalation target
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Test catalogue ----------
CREATE TABLE IF NOT EXISTS lab_tests (
  id                SERIAL PRIMARY KEY,
  code              TEXT    NOT NULL UNIQUE,
  name              TEXT    NOT NULL,
  category          TEXT    NOT NULL CHECK (category IN ('quantitative','qualitative','culture')),
  unit              TEXT,
  ref_low           NUMERIC,
  ref_high          NUMERIC,
  panic_low         NUMERIC,
  panic_high        NUMERIC,
  panic_on_positive BOOLEAN NOT NULL DEFAULT FALSE,     -- qualitative/culture: positive = panic
  tat_hours         NUMERIC NOT NULL DEFAULT 24,        -- expected turnaround (routine)
  stat_tat_hours    NUMERIC NOT NULL DEFAULT 2,         -- expected turnaround (STAT)
  active            BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS panels (
  id     SERIAL PRIMARY KEY,
  code   TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS panel_tests (
  panel_id INT NOT NULL REFERENCES panels(id) ON DELETE CASCADE,
  test_id  INT NOT NULL REFERENCES lab_tests(id),
  PRIMARY KEY (panel_id, test_id)
);

-- ---------- Orders ----------
CREATE TABLE IF NOT EXISTS orders (
  id                     SERIAL PRIMARY KEY,
  patient_id             INT  NOT NULL REFERENCES users(id),
  physician_id           INT  NOT NULL REFERENCES users(id),
  priority               TEXT NOT NULL CHECK (priority IN ('routine','stat')),
  status                 TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','ASSIGNED','IN_PROGRESS','CLOSED','CANCELLED')),
  assigned_technician_id INT REFERENCES users(id),
  notes                  TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at              TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_orders_patient   ON orders(patient_id);
CREATE INDEX IF NOT EXISTS idx_orders_physician ON orders(physician_id);
CREATE INDEX IF NOT EXISTS idx_orders_tech      ON orders(assigned_technician_id);
CREATE INDEX IF NOT EXISTS idx_orders_status    ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created   ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_panels (
  id       SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  panel_id INT NOT NULL REFERENCES panels(id)
);

CREATE TABLE IF NOT EXISTS specimens (
  id               SERIAL PRIMARY KEY,
  order_id         INT  NOT NULL REFERENCES orders(id),
  accession_number TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL CHECK (status IN ('COLLECTED','IN_PROCESSING','REJECTED')),
  collected_by     INT  NOT NULL REFERENCES users(id),
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  rejection_reason TEXT,
  rejected_at      TIMESTAMPTZ
);

-- One row per component test. Panels expand into several items.
CREATE TABLE IF NOT EXISTS order_items (
  id             SERIAL PRIMARY KEY,
  order_id       INT  NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  test_id        INT  NOT NULL REFERENCES lab_tests(id),
  order_panel_id INT  REFERENCES order_panels(id),
  specimen_id    INT  REFERENCES specimens(id),
  status         TEXT NOT NULL DEFAULT 'COLLECTION_REQUIRED'
                 CHECK (status IN ('COLLECTION_REQUIRED','COLLECTED','IN_PROCESSING',
                                   'RESULT_AVAILABLE','UNDER_REVIEW','RELEASED','CANCELLED')),
  retest_reason  TEXT,
  released_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_test  ON order_items(test_id);

-- ---------- Results (append-only versions) ----------
CREATE TABLE IF NOT EXISTS result_versions (
  id               SERIAL PRIMARY KEY,
  order_item_id    INT  NOT NULL REFERENCES order_items(id),
  version          INT  NOT NULL,
  category         TEXT NOT NULL,
  data             JSONB NOT NULL,
  abnormal_flag    TEXT,            -- 'H','L','A' (abnormal qualitative) or NULL
  is_panic         BOOLEAN NOT NULL DEFAULT FALSE,
  entered_by       INT  NOT NULL REFERENCES users(id),
  entered_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_amendment     BOOLEAN NOT NULL DEFAULT FALSE,
  amendment_reason TEXT,
  released_by      INT REFERENCES users(id),
  released_at      TIMESTAMPTZ,
  UNIQUE (order_item_id, version)
);

-- R-11: result versions can never be deleted, and a released version can never change.
-- The only permitted UPDATE is stamping released_by/released_at on an unreleased version.
CREATE OR REPLACE FUNCTION result_versions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'result_versions is append-only: delete not allowed';
  END IF;
  IF OLD.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'released result version % cannot be modified', OLD.id;
  END IF;
  IF NEW.data IS DISTINCT FROM OLD.data
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.order_item_id IS DISTINCT FROM OLD.order_item_id
     OR NEW.abnormal_flag IS DISTINCT FROM OLD.abnormal_flag
     OR NEW.is_panic IS DISTINCT FROM OLD.is_panic
     OR NEW.entered_by IS DISTINCT FROM OLD.entered_by THEN
    RAISE EXCEPTION 'result version content is immutable; create a new version instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_result_versions_guard ON result_versions;
CREATE TRIGGER trg_result_versions_guard
  BEFORE UPDATE OR DELETE ON result_versions
  FOR EACH ROW EXECUTE FUNCTION result_versions_guard();

-- ---------- Panic-value alerts / escalation ----------
CREATE TABLE IF NOT EXISTS panic_alerts (
  id                 SERIAL PRIMARY KEY,
  result_version_id  INT  NOT NULL REFERENCES result_versions(id),
  order_item_id      INT  NOT NULL REFERENCES order_items(id),
  stage              TEXT NOT NULL DEFAULT 'ORDERING'
                     CHECK (stage IN ('ORDERING','ON_CALL','DIRECTOR')),
  status             TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED')),
  current_target_id  INT  REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL,
  stage_started_at   TIMESTAMPTZ NOT NULL,
  acknowledged_by    INT  REFERENCES users(id),
  acknowledged_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_panic_open ON panic_alerts(status, stage_started_at);

-- ---------- Notifications (simulated delivery, in-app) ----------
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INT  NOT NULL REFERENCES users(id),
  type        TEXT NOT NULL,
  message     TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

-- ---------- Audit trail (R-19) ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id   INT  NOT NULL,
  action      TEXT NOT NULL,
  from_state  TEXT,
  to_state    TEXT,
  actor_id    INT REFERENCES users(id),
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_guard ON audit_log;
CREATE TRIGGER trg_audit_log_guard
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_guard();

CREATE SEQUENCE IF NOT EXISTS accession_seq START 1;
