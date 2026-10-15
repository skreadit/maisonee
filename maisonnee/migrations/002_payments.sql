ALTER TABLE chef_profiles ADD COLUMN stripe_event_created bigint NOT NULL DEFAULT 0;
CREATE TABLE payment_attempts (
 id text PRIMARY KEY, booking_id text NOT NULL REFERENCES bookings(id),
 checkout_session_id text UNIQUE, payment_intent_id text UNIQUE,
 amount_cents integer NOT NULL CHECK(amount_cents>0), commission_cents integer NOT NULL CHECK(commission_cents>=0 AND commission_cents<=amount_cents),
 currency text NOT NULL CHECK(currency='eur'), stripe_account_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('CREATED','PENDING','SUCCEEDED','EXPIRED','REVIEW','REFUNDED','PARTIALLY_REFUNDED')),
 refunded_cents integer NOT NULL DEFAULT 0 CHECK(refunded_cents>=0 AND refunded_cents<=amount_cents), checkout_url text,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_attempts_booking_idx ON payment_attempts(booking_id,created_at);
CREATE UNIQUE INDEX payment_attempts_active ON payment_attempts(booking_id) WHERE state <> 'EXPIRED';
CREATE TABLE payment_events (
 id text PRIMARY KEY, type text NOT NULL, outcome text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE refunds (
 id text PRIMARY KEY, booking_id text NOT NULL REFERENCES bookings(id), payment_attempt_id text NOT NULL UNIQUE REFERENCES payment_attempts(id),
 amount_cents integer NOT NULL CHECK(amount_cents>0), state text NOT NULL, stripe_refund_id text UNIQUE,
 policy_version text NOT NULL, reason text NOT NULL, created_by text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
