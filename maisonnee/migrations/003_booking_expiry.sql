ALTER TABLE bookings ADD COLUMN request_expires_at timestamptz;
UPDATE bookings SET request_expires_at=LEAST(created_at+interval '24 hours', date::date::timestamp AT TIME ZONE 'Europe/Paris');
ALTER TABLE bookings ALTER COLUMN request_expires_at SET NOT NULL;
ALTER TABLE bookings ALTER COLUMN request_expires_at SET DEFAULT (now()+interval '24 hours');
UPDATE bookings SET payment_expires_at=LEAST(updated_at+interval '24 hours', date::date::timestamp AT TIME ZONE 'Europe/Paris') WHERE status='ACCEPTED' AND payment_expires_at IS NULL;
CREATE INDEX bookings_request_expiry_idx ON bookings(request_expires_at) WHERE status='REQUESTED';
CREATE INDEX bookings_payment_expiry_idx ON bookings(payment_expires_at) WHERE status='ACCEPTED';
