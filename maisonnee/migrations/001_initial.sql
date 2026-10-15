CREATE TABLE users (
 id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'CLIENT' CHECK(role IN ('CLIENT','CHEF','ADMIN')), phone text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '',
 email_verified_at timestamptz, terms_accepted_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE TABLE rate_limits (key text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE chef_profiles (
 id text PRIMARY KEY, user_id text NOT NULL UNIQUE REFERENCES users(id), slug text NOT NULL UNIQUE, name text NOT NULL, city text NOT NULL,
 cuisine text NOT NULL, bio text NOT NULL, image text NOT NULL DEFAULT '/images/chef-table.jpg', portrait text NOT NULL DEFAULT '', tags jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED','SUSPENDED')),
 travel_cents integer NOT NULL DEFAULT 0 CHECK(travel_cents>=0), stripe_account_id text UNIQUE, stripe_ready boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chef_public_idx ON chef_profiles(status,city);
CREATE TABLE menus (
 id text PRIMARY KEY, chef_id text NOT NULL REFERENCES chef_profiles(id), name text NOT NULL, description text NOT NULL,
 starter text NOT NULL, main text NOT NULL, dessert text NOT NULL, price_per_person integer NOT NULL CHECK(price_per_person>0),
 min_guests integer NOT NULL CHECK(min_guests>0), max_guests integer NOT NULL CHECK(max_guests>=min_guests), allergens text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE chef_availability (chef_id text NOT NULL REFERENCES chef_profiles(id), date text NOT NULL CHECK(date ~ '^\d{4}-\d{2}-\d{2}$'), PRIMARY KEY(chef_id,date));
CREATE TABLE commission_rules (id text PRIMARY KEY, basis_points integer NOT NULL CHECK(basis_points BETWEEN 0 AND 5000), active boolean NOT NULL DEFAULT true, created_by text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX one_active_commission ON commission_rules(active) WHERE active;
CREATE TABLE bookings (
 id text PRIMARY KEY, chef_id text NOT NULL REFERENCES chef_profiles(id), client_id text NOT NULL REFERENCES users(id), menu_id text NOT NULL REFERENCES menus(id),
 date text NOT NULL CHECK(date ~ '^\d{4}-\d{2}-\d{2}$'), guests integer NOT NULL CHECK(guests>0), menu_name text NOT NULL, menu_snapshot jsonb NOT NULL,
 commission_rule_id text NOT NULL REFERENCES commission_rules(id), commission_basis_points integer NOT NULL,
 total_cents integer NOT NULL CHECK(total_cents>0), commission_cents integer NOT NULL CHECK(commission_cents>=0), chef_net_cents integer NOT NULL CHECK(chef_net_cents>=0),
 travel_cents integer NOT NULL DEFAULT 0 CHECK(travel_cents>=0), currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
 status text NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','ACCEPTED','CONFIRMED','COMPLETED','CANCELLED','DECLINED','DISPUTED','EXPIRED')),
 payment_status text NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID','PENDING','PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED')),
 payment_expires_at timestamptz, stripe_checkout_session_id text, stripe_payment_intent_id text, address text NOT NULL, notes text NOT NULL DEFAULT '',
 idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(client_id,idempotency_key), CHECK(total_cents=commission_cents+chef_net_cents)
);
CREATE UNIQUE INDEX one_active_booking ON bookings(chef_id,date) WHERE status IN ('REQUESTED','ACCEPTED','CONFIRMED','DISPUTED');
CREATE INDEX bookings_client_idx ON bookings(client_id,created_at);
CREATE INDEX bookings_chef_idx ON bookings(chef_id,date);
CREATE TABLE booking_status_history (id text PRIMARY KEY, booking_id text NOT NULL REFERENCES bookings(id), status text NOT NULL, actor_id text REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE favorites (user_id text NOT NULL REFERENCES users(id), chef_id text NOT NULL REFERENCES chef_profiles(id), PRIMARY KEY(user_id,chef_id));
CREATE TABLE messages (id text PRIMARY KEY, booking_id text NOT NULL REFERENCES bookings(id), sender_id text NOT NULL REFERENCES users(id), body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX messages_booking_idx ON messages(booking_id,created_at);
CREATE TABLE notifications (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), title text NOT NULL, body text NOT NULL, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE reviews (id text PRIMARY KEY, booking_id text NOT NULL UNIQUE REFERENCES bookings(id), chef_id text NOT NULL REFERENCES chef_profiles(id), client_id text NOT NULL REFERENCES users(id), rating integer NOT NULL CHECK(rating BETWEEN 1 AND 5), comment text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE support_tickets (id text PRIMARY KEY, user_id text REFERENCES users(id), email text NOT NULL, category text NOT NULL, subject text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'OPEN', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_logs (id text PRIMARY KEY, actor_id text REFERENCES users(id), action text NOT NULL, resource_type text NOT NULL, resource_id text, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notification_outbox (id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), template text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'PENDING', attempts integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
