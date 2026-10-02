# 04 — Data Model (PostgreSQL)

Design constraints that shaped this schema:

1. **Money is never a float.** Every amount is `BIGINT` paisa. There is a `CHECK` against
   nothing sensible, but there *is* an `IMMUTABLE` constraint on posted ledger rows.
2. **Audit is append-only and hash-chained.** Evidence and audit cannot be mutated; "delete" is
   a tombstone.
3. **The money invariant is structural.** Commission cannot be posted unless the transaction is
   in a state that permits it — enforced by a trigger reading `transactions.purchase_completed_at`,
   not by application discipline.
4. **Declared vs verified seller data live in different tables** and are never joined into one
   record.
5. **Seller phones are hashed**, not stored plaintext, outside of an encrypted blob the agent
   explicitly submitted.
6. **PostGIS** for service areas; no separate geo service in MVP.

Extensions: `pgcrypto`, `postgis`, `pg_trgm`, `btree_gin`.

---

## 0. Enums

```sql
CREATE TYPE user_status         AS ENUM ('pending','active','suspended','banned','deleted');
CREATE TYPE role                AS ENUM ('buyer','agent','staff_ops','staff_ts','staff_finance','admin');
CREATE TYPE kyc_tier            AS ENUM ('L0','L1','L2','L3');
CREATE TYPE kyc_status          AS ENUM ('none','pending','verified','rejected','expired','manual_review');
CREATE TYPE agent_status        AS ENUM ('onboarding','pending_review','active','paused','suspended','banned','exited');
CREATE TYPE agent_clearance     AS ENUM ('none','basic','phone_electronics','computers','appliances','furniture','vehicles_static','machinery','high_value');
CREATE TYPE category_risk       AS ENUM ('prohibited','restricted','standard');
CREATE TYPE request_status      AS ENUM ('draft','published','response_received','agent_selected','expired','cancelled','converted');
CREATE TYPE offer_kind          AS ENUM ('accept','counter');
CREATE TYPE offer_status        AS ENUM ('open','accepted','declined','superseded','expired','withdrawn');
-- Declining is penalty-free for safety, qualification, and "the bid is too low". We record the
-- reason because bid-vs-supply is the signal behind DECISIONS.md section 5.3.
CREATE TYPE decline_reason      AS ENUM ('too_far','bid_too_low','category_not_covered','not_available',
                                       'safety_concern','no_transport','other');
CREATE TYPE txn_state           AS ENUM (
  'draft','awaiting_bid_payment','request_published','response_received','agent_selected',
  'bid_secured','agent_en_route','agent_arrived',
  'seller_identity_pending','seller_identity_verified','possession_pending',
  'possession_confirmed','possession_failed',
  'inspection_in_progress','live_session_active','live_session_end','inspection_reported',
  'negotiation_open','negotiation_waiting_buyer','buyer_decision_pending','buyer_rejected',
  'purchase_authorized','settlement_pending','settlement_verified','purchase_completed',
  'custody_verified','purchase_cancelled','item_collected','packaged','handover_pending',
  'courier_handover_confirmed','in_transit','delivered_courier','delivered_agent','delivered',
  'buyer_confirmed_receipt','dispute_window_elapsed','commission_settled','transaction_completed',
  'dispute_opened','dispute_resolved','aborted_unsafe','agent_no_show','buyer_abandoned',
  'bid_refunded','deal_failed','expired_request','cancelled_by_buyer'
);
CREATE TYPE verdict             AS ENUM ('pass','pass_with_notes','mismatch','fail','aborted');
CREATE TYPE check_status        AS ENUM ('pass','fail','warn','na');
CREATE TYPE evidence_kind       AS ENUM ('listing_screenshot','seller_photo','seller_doc','seller_selfie',
  'product_photo','product_video','serial_photo','damage_photo','accessory_photo','test_recording',
  'compare_shot','package_photo','handover_photo','pod_photo','receipt','payment_proof','location_fix',
  'live_recording','chat_export','agent_note','buyer_note','ops_note');
CREATE TYPE seal_reason         AS ENUM ('submitted','tier_limit','risk_hold','buyer_request','ops_override');
CREATE TYPE payment_purpose     AS ENUM ('bid','buyer_success_fee','seller_success_fee','dealer_bonus','refund','payout','adjustment','dispute_remedy');
CREATE TYPE payment_method      AS ENUM ('card','bank_transfer','easypaisa','jazzcash','wallet_balance','cash','adjustment');
CREATE TYPE payment_status      AS ENUM ('created','pending','authorized','captured','failed','refunded','partially_refunded','disputed','reversed');
CREATE TYPE ledger_account_kind AS ENUM ('asset','liability','equity','revenue','expense','contra');
CREATE TYPE negotiation_kind    AS ENUM ('seller_asking','counter','seller_counter','accept','reject','buyer_override','buyer_hold');
CREATE TYPE dispute_status      AS ENUM ('open','awaiting_buyer','awaiting_agent','awaiting_seller','under_review','resolved','appealed','closed');
CREATE TYPE dispute_party_role  AS ENUM ('buyer','agent','seller','courier','platform');
CREATE TYPE dispute_reason      AS ENUM (
  'product_not_as_inspected','product_damaged_in_transit','product_damaged_after_approval',
  'serial_mismatch','agent_false_report','seller_false_information','unauthorized_purchase',
  'seller_not_paid','buyer_abandoned_after_payment','agent_no_show','agent_absconded_with_item',
  'courier_lost_or_damaged','missing_accessories','fee_dispute','safety_incident','platform_fault','other');
CREATE TYPE dispute_remedy      AS ENUM ('full_refund_success_fee','partial_refund','release_to_agent','deny','split','re_inspect','courier_claim','suspend_agent','ban_seller','none');
CREATE TYPE shipment_mode       AS ENUM ('courier','agent_direct','other');
CREATE TYPE shipment_status     AS ENUM ('label_created','pickup_pending','picked_up','in_transit','out_for_delivery','delivered','attempted','returned','lost','damaged');
CREATE TYPE risk_signal_code    AS ENUM (
  'multiple_accounts','device_reuse','impossible_travel','gps_mismatch','low_accuracy_spoof',
  'image_reuse','image_manipulation','no_capture_attestation','checklist_gaps','report_amended',
  'repeated_fail_verdicts','high_cancel_rate','seller_repeat','seller_known_bad','collusion_graph',
  'price_anomaly','serial_blacklist_hit','bank_account_mismatch','kyc_mismatch','unreachable_buyer',
  'cash_ceiling_pressure','fast_serial_read');
CREATE TYPE subject_type        AS ENUM ('user','agent','seller_entity','transaction','request','payment','device','ip');
CREATE TYPE notif_channel       AS ENUM ('inapp','push','sms','email');
CREATE TYPE notif_status        AS ENUM ('queued','sent','delivered','read','failed','suppressed');
CREATE TYPE moderation_kind     AS ENUM ('agent_kyc','high_value_review','fraud_review','dispute','seller_abuse','buyer_abuse','agent_abuse','refund_review','payout_hold','complaint');
CREATE TYPE moderation_status   AS ENUM ('open','investigating','actioned','dismissed','appealed');
```

---

## 1. Identity, geography, and people

```sql
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164        TEXT NOT NULL,
  phone_hash        TEXT NOT NULL,                    -- HMAC-SHA256(pepper, phone)
  phone_verified_at TIMESTAMPTZ,
  role              role NOT NULL,
  status            user_status NOT NULL DEFAULT 'pending',
  display_name      TEXT NOT NULL,
  avatar_object_id  UUID,
  preferred_locale  TEXT NOT NULL DEFAULT 'en-PK',
  kyc_tier          kyc_tier NOT NULL DEFAULT 'L0',
  kyc_status        kyc_status NOT NULL DEFAULT 'none',
  last_seen_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at        TIMESTAMPTZ,
  CONSTRAINT users_phone_unique UNIQUE (phone_e164)
);
CREATE INDEX users_phone_hash_idx ON users (phone_hash);
CREATE INDEX users_role_status_idx ON users (role, status) WHERE deleted_at IS NULL;
CREATE INDEX users_name_trgm ON users USING gin (display_name gin_trgm_ops);

CREATE TABLE user_profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio            TEXT,
  home_city_id   UUID,
  languages      TEXT[] NOT NULL DEFAULT '{}',
  timezone       TEXT NOT NULL DEFAULT 'Asia/Karachi',
  marketing_opt_in BOOLEAN NOT NULL DEFAULT false,
  emergency_contact_name  TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relation TEXT,
  extra          JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE user_devices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform       TEXT NOT NULL CHECK (platform IN ('android','ios')),
  app_version    TEXT NOT NULL,
  os_version     TEXT,
  device_model   TEXT,
  install_id     UUID NOT NULL,                       -- reinstall-stable-ish id
  fingerprint    JSONB NOT NULL DEFAULT '{}',          -- attestation, play integrity
  push_token     TEXT,
  is_trusted     BOOLEAN NOT NULL DEFAULT false,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX user_devices_user_idx ON user_devices (user_id);
CREATE INDEX user_devices_fingerprint_idx ON user_devices ((fingerprint->>'device_hash'))
       WHERE fingerprint ? 'device_hash';
CREATE UNIQUE INDEX user_devices_install_idx ON user_devices (install_id);

CREATE TABLE cities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  lat          NUMERIC(9,6) NOT NULL,
  lng          NUMERIC(9,6) NOT NULL,
  timezone     TEXT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  meta         JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX cities_cc_name_idx ON cities (country_code, name);
```

---

## 2. KYC and payouts

```sql
CREATE TABLE kyc_documents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_type       TEXT NOT NULL CHECK (doc_type IN ('cnic','passport','nicop_2022','driving_licence','business_proof')),
  -- Encrypted at field level with a KMS CMK. Never returned by any API to non-T&S roles.
  doc_number_enc BYTEA NOT NULL,
  doc_number_last4 CHAR(4) NOT NULL,
  doc_number_hash TEXT NOT NULL,
  issuer         TEXT,
  issued_on      DATE,
  expires_on     DATE,
  front_object_id UUID,
  back_object_id  UUID,
  selfie_object_id UUID,
  provider        TEXT,                                -- 'nadra','manual','idcheck'
  provider_ref    TEXT,
  provider_payload JSONB,                              -- raw, restricted
  liveness_score  NUMERIC(5,4),
  face_match_score NUMERIC(5,4),
  status          kyc_status NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One live document per (user, type); rejected attempts do not block a fresh submission.
-- A partial UNIQUE INDEX is the only valid PostgreSQL construct here -- a conditional
-- UNIQUE table constraint is rejected by the parser.
CREATE UNIQUE INDEX kyc_docs_unique_live_type ON kyc_documents (user_id, doc_type)
       WHERE status <> 'rejected';
CREATE INDEX kyc_docs_pending_idx ON kyc_documents (status) WHERE status = 'pending';

CREATE TABLE kyc_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier          kyc_tier NOT NULL,
  status        kyc_status NOT NULL,
  method        TEXT NOT NULL,
  score         NUMERIC(5,4),
  granted_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  features      JSONB NOT NULL DEFAULT '{}',           -- capability grants
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX kyc_records_user_idx ON kyc_records (user_id, tier);

CREATE TABLE payout_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name      TEXT NOT NULL,
  iban_enc       BYTEA NOT NULL,
  iban_last4     CHAR(4) NOT NULL,
  iban_hash      TEXT NOT NULL,
  account_title  TEXT,
  title_match_status TEXT NOT NULL DEFAULT 'unchecked'
        CHECK (title_match_status IN ('unchecked','matched','mismatched','manual_review')),
  is_primary     BOOLEAN NOT NULL DEFAULT false,
  status         kyc_status NOT NULL DEFAULT 'pending',
  verified_at    TIMESTAMPTZ,
  payout_hold_until TIMESTAMPTZ,                       -- rolling hold for new agents
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payout_accounts_primary_idx ON payout_accounts (user_id) WHERE is_primary;
CREATE INDEX payout_accounts_iban_idx ON payout_accounts (iban_hash);
```

---

## 3. Agents

```sql
CREATE TABLE agent_profiles (
  user_id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status                  agent_status NOT NULL DEFAULT 'onboarding',
  home_city_id            UUID REFERENCES cities(id),
  current_city_id         UUID REFERENCES cities(id),
  max_travel_km           INTEGER NOT NULL DEFAULT 15 CHECK (max_travel_km BETWEEN 1 AND 500),
  hourly_rate_minor       BIGINT,                        -- advisory, unused in MVP
  availability_json       JSONB NOT NULL DEFAULT '{}',   -- weekday windows per city
  languages               TEXT[] NOT NULL DEFAULT '{}',
  bio                     TEXT,
  photo_object_id         UUID,
  rating_avg              NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count            INTEGER NOT NULL DEFAULT 0,
  completed_inspections   INTEGER NOT NULL DEFAULT 0,
  completed_purchases     INTEGER NOT NULL DEFAULT 0,
  cancelled_by_seller     INTEGER NOT NULL DEFAULT 0,
  declined_quality        INTEGER NOT NULL DEFAULT 0,     -- NOT safety declines
  declined_safety         INTEGER NOT NULL DEFAULT 0,     -- never penalised
  no_show_count           INTEGER NOT NULL DEFAULT 0,
  avg_first_response_sec  INTEGER,
  avg_resolution_minutes  INTEGER,
  trust_score             NUMERIC(5,2) NOT NULL DEFAULT 50,
  risk_score              NUMERIC(5,2) NOT NULL DEFAULT 0,
  max_declared_value_minor BIGINT NOT NULL DEFAULT 100000, -- custody ceiling
  max_cash_minor          BIGINT NOT NULL DEFAULT 5000,
  onboarding_completed_at TIMESTAMPTZ,
  approved_at             TIMESTAMPTZ,
  suspended_at            TIMESTAMPTZ,
  suspension_reason       TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_rating_range CHECK (rating_avg >= 0 AND rating_avg <= 5)
);

CREATE TABLE agent_service_areas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agent_profiles(user_id) ON DELETE CASCADE,
  city_id     UUID NOT NULL REFERENCES cities(id),
  area        geometry(Polygon, 4326) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT areas_valid_geom CHECK (ST_IsValid(area))
);
CREATE INDEX areas_gix ON agent_service_areas USING gist (area);
CREATE INDEX areas_agent_idx ON agent_service_areas (agent_id);

CREATE TABLE agent_skill_clearances (
  agent_id     UUID NOT NULL REFERENCES agent_profiles(user_id) ON DELETE CASCADE,
  clearance    agent_clearance NOT NULL,
  granted_by   UUID REFERENCES users(id),
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ,
  PRIMARY KEY (agent_id, clearance)
);

CREATE TABLE agent_category_skills (
  agent_id      UUID NOT NULL REFERENCES agent_profiles(user_id) ON DELETE CASCADE,
  category_id   UUID NOT NULL,             -- FK added in section 13.5: -> categories (defined later)
  level         SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
  verified_by   UUID REFERENCES users(id),
  verified_at   TIMESTAMPTZ,
  PRIMARY KEY (agent_id, category_id)
);
```

---

## 4. Catalogue, risk policy, and checklists

```sql
CREATE TABLE categories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id      UUID REFERENCES categories(id),
  slug           TEXT NOT NULL UNIQUE,
  name_en        TEXT NOT NULL,
  name_ur        TEXT,
  depth          SMALLINT NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  has_serial     BOOLEAN NOT NULL DEFAULT false,
  has_ownership_proof BOOLEAN NOT NULL DEFAULT false,
  requires_agent_clearance agent_clearance NOT NULL DEFAULT 'basic',
  max_declared_value_minor BIGINT,                      -- null = no platform cap
  prohibited_reason TEXT,
  search_vector  TSVECTOR,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX categories_parent_idx ON categories (parent_id);
CREATE INDEX categories_search_idx ON categories USING gin (search_vector);

CREATE TABLE category_risk_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  UUID REFERENCES categories(id),
  pattern      TEXT,                                     -- keyword regex, nullable
  match_on     JSONB NOT NULL DEFAULT '{}',              -- {title,description,evidence_text}
  severity     SMALLINT NOT NULL DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  action       TEXT NOT NULL CHECK (action IN ('block','flag','require_review')),
  reason       TEXT NOT NULL,
  created_by   UUID REFERENCES users(id),
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX category_risk_rules_active_idx ON category_risk_rules (active) WHERE active;

CREATE TABLE checklist_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id),
  version     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, version)
);

CREATE TABLE checklist_template_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID NOT NULL REFERENCES checklist_templates(id) ON DELETE CASCADE,
  section       TEXT NOT NULL,
  position      INTEGER NOT NULL,
  key           TEXT NOT NULL,
  label         TEXT NOT NULL,
  hint          TEXT,
  input_type    TEXT NOT NULL DEFAULT 'status'
        CHECK (input_type IN ('status','number','text','select','photo_required','video_required','serial')),
  options       JSONB,
  pass_criteria TEXT,
  fail_criteria TEXT,
  is_mandatory  BOOLEAN NOT NULL DEFAULT true,
  min_media     SMALLINT NOT NULL DEFAULT 0,
  UNIQUE (template_id, key)
);
CREATE INDEX ct_items_tpl_idx ON checklist_template_items (template_id, section, position);
```

---

## 5. Requests, buyer bids, and dealer responses

> **Direction of the flow has changed** (`DECISIONS.md` §5). The buyer now **bids first**: they
> post an amount to hire an inspector, and the dealer feed shows that bid with amount, distance,
> location, and the check list. The dealer accepts, counters once, or declines. On accept the
> buyer pays the bid in-app.
>
> So the **bid lives on `requests`** and `offers` is now the **dealer's response** to it. This is
> the reverse of the earlier draft, where dealers bid against a request and the buyer selected.

```sql
CREATE TABLE requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id              UUID NOT NULL REFERENCES users(id),
  status                request_status NOT NULL DEFAULT 'draft',
  category_id           UUID NOT NULL REFERENCES categories(id),
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL DEFAULT '',
  seller_source         TEXT NOT NULL CHECK (seller_source IN
                          ('facebook','olx','whatsapp','instagram','website','shop','other')),
  seller_listing_url    TEXT,
  -- DECLARED by buyer. Never merged with verified seller_entities.
  seller_name_declared  TEXT,
  seller_phone_declared TEXT,
  seller_city_id        UUID NOT NULL REFERENCES cities(id),
  seller_area_text      TEXT NOT NULL,
  seller_gps            geography(Point, 4326),
  currency              CHAR(3) NOT NULL DEFAULT 'PKR',
  declared_price_minor  BIGINT NOT NULL CHECK (declared_price_minor >= 0),
  max_authorized_minor  BIGINT NOT NULL CHECK (max_authorized_minor >= 0),
  negotiation_target_minor BIGINT,
  negotiation_enabled   BOOLEAN NOT NULL DEFAULT false,
  buyer_notes           TEXT,
  required_live_session BOOLEAN NOT NULL DEFAULT false,
  urgency               TEXT NOT NULL DEFAULT 'standard' CHECK (urgency IN ('standard','urgent')),
  template_id           UUID REFERENCES checklist_templates(id),
  template_version      INTEGER,
  risk_score            NUMERIC(5,2) NOT NULL DEFAULT 0,
  -- THE BUYER'S BID: the amount they will pay an inspector to do this job.
  -- The platform takes no cut of it; the accepted dealer is paid this in full.
  bid_minor             BIGINT NOT NULL CHECK (bid_minor > 0),
  bid_is_below_band     BOOLEAN NOT NULL DEFAULT false,  -- allowed, but flagged in the dealer feed
  suggested_fee_min     BIGINT,   -- band shown to the buyer at bid time and to dealers beside the bid
  suggested_fee_mid     BIGINT,
  suggested_fee_max     BIGINT,
  bid_locked_at         TIMESTAMPTZ,  -- set on first dealer acceptance; bid is immutable thereafter
  published_at          TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  converted_txn_id      UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT requests_price_band CHECK (
      max_authorized_minor >= (declared_price_minor * 60) / 100
      AND max_authorized_minor <= (declared_price_minor * 120) / 100 + 1),
  CONSTRAINT requests_negotiation_fields CHECK (
      NOT negotiation_enabled
      OR (negotiation_target_minor IS NOT NULL AND negotiation_target_minor > 0
          AND negotiation_target_minor <= max_authorized_minor))
);
CREATE INDEX requests_feed_idx  ON requests (status, seller_city_id, category_id, published_at DESC)
       WHERE status IN ('published','response_received');
CREATE INDEX requests_gps_idx  ON requests USING gist (seller_gps);
CREATE INDEX requests_buyer_idx ON requests (buyer_id, created_at DESC);
CREATE INDEX requests_open_per_buyer ON requests (buyer_id) WHERE status IN
       ('draft','published','response_received','agent_selected');

-- The dealer feed: live bids within this agent's service radius, excluding own and closed ones.
CREATE INDEX requests_dealer_feed_idx ON requests (published_at DESC)
       WHERE status = 'published';

CREATE TABLE request_checklist_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  key          TEXT NOT NULL,
  section      TEXT NOT NULL,
  label        TEXT NOT NULL,
  position     INTEGER NOT NULL,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  is_custom    BOOLEAN NOT NULL DEFAULT false,
  custom_label TEXT,
  UNIQUE (request_id, key)
);

CREATE TABLE request_evidence (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  object_id   UUID NOT NULL,             -- FK added below: request_evidence -> evidence_objects
  kind        evidence_kind NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note        TEXT,
  sort_order  SMALLINT NOT NULL DEFAULT 0
);
CREATE INDEX request_evidence_req_idx ON request_evidence (request_id, sort_order);

-- A DEALER'S RESPONSE to a buyer's bid on `requests`. The buyer's own bid is
-- `requests.bid_minor`; this table records who took it, who countered, who declined, and why.
CREATE TABLE offers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  agent_id          UUID NOT NULL REFERENCES agent_profiles(user_id),
  parent_offer_id   UUID REFERENCES offers(id),
  kind              offer_kind NOT NULL,        -- 'accept' | 'counter' (never 'buyer_bid' here)
  status            offer_status NOT NULL DEFAULT 'open',
  -- The amount THIS dealer is asking for. On kind='accept' it equals requests.bid_minor.
  proposed_fee_minor    BIGINT NOT NULL CHECK (proposed_fee_minor > 0),
  travel_fee_minor  BIGINT NOT NULL DEFAULT 0 CHECK (travel_fee_minor >= 0),
  total_fee_minor   BIGINT GENERATED ALWAYS AS (proposed_fee_minor + travel_fee_minor) STORED,
  -- Shown to the dealer before they accept: straight-line distance from the agent's base.
  distance_km       NUMERIC(6,2),
  below_band        BOOLEAN NOT NULL DEFAULT false,  -- counter landed under the suggested floor
  eta_minutes       INTEGER NOT NULL,
  available_at      TIMESTAMPTZ NOT NULL,
  message           TEXT,
  decline_reason    decline_reason,           -- 'safety' and 'over_bid' are penalty-free
  counter_round     SMALLINT NOT NULL DEFAULT 0,
  expires_at        TIMESTAMPTZ NOT NULL,
  accepted_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT offers_counter_cap  CHECK (counter_round <= 1)    -- ONE counter per chain in MVP
);
CREATE INDEX offers_req_idx   ON offers (request_id, status);
CREATE INDEX offers_agent_idx ON offers (agent_id, status, created_at DESC);
CREATE INDEX offers_live_idx  ON offers (request_id, expires_at) WHERE status = 'open';

-- "One dealer wins" guarantee. A partial UNIQUE INDEX is the only construct PostgreSQL
-- accepts for conditional uniqueness, and it does not fire when a status later leaves
-- 'accepted' -- which is what we want, so a declined row does not block a re-bid.
CREATE UNIQUE INDEX idx_offers_one_accepted ON offers (request_id)
       WHERE status = 'accepted';

-- An 'accept' must match the buyer's current bid exactly, and the bid freezes on first
-- acceptance. Both need a trigger: a CHECK constraint cannot read another table.
CREATE OR REPLACE FUNCTION offers_accept_matches_bid() RETURNS TRIGGER AS $$
DECLARE req RECORD;
BEGIN
  SELECT bid_minor, bid_locked_at, status INTO req FROM requests WHERE id = NEW.request_id FOR UPDATE;
  IF req.status <> 'published' THEN
    RAISE EXCEPTION 'offer rejected: request % is %, not published', NEW.request_id, req.status;
  END IF;
  IF NEW.kind = 'accept' AND NEW.proposed_fee_minor <> req.bid_minor THEN
    RAISE EXCEPTION 'accept must equal buyer bid % (got %)', req.bid_minor, NEW.proposed_fee_minor;
  END IF;
  IF req.bid_locked_at IS NULL THEN
    UPDATE requests SET bid_locked_at = now() WHERE id = NEW.request_id;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offers_accept_matches_bid
  BEFORE INSERT OR UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION offers_accept_matches_bid();

-- Sibling responses close atomically when one dealer is accepted, mirroring FR-OFF-05.
CREATE OR REPLACE FUNCTION offers_close_siblings() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'accepted' THEN
    UPDATE offers SET status = 'superseded'
     WHERE request_id = NEW.request_id AND id <> NEW.id AND status = 'open';
    UPDATE requests SET status = 'agent_selected' WHERE id = NEW.request_id;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offers_close_siblings
  AFTER UPDATE OF status ON offers
  FOR EACH ROW EXECUTE FUNCTION offers_close_siblings();
```

---

## 6. Seller entities (the "verified" side — deliberately separate)

```sql
CREATE TABLE seller_entities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_key           TEXT NOT NULL UNIQUE,   -- derived hash: phone_hash + name_norm prefix
  phone_hash           TEXT,
  phone_last4          CHAR(4),
  name_enc             BYTEA,                 -- encrypted
  name_norm_hash       TEXT,
  declared_city_id     UUID REFERENCES cities(id),
  verified_city_id     UUID REFERENCES cities(id),
  identity_status      kyc_status NOT NULL DEFAULT 'none',
  id_verified_at       TIMESTAMPTZ,
  possession_rate      NUMERIC(4,3),           -- share of visits with ownership proof
  sighting_count       INTEGER NOT NULL DEFAULT 0,
  deal_count           INTEGER NOT NULL DEFAULT 0,
  fail_verdict_count   INTEGER NOT NULL DEFAULT 0,
  buyer_dispute_count  INTEGER NOT NULL DEFAULT 0,
  agent_dispute_count  INTEGER NOT NULL DEFAULT 0,
  avg_claimed_vs_verified_gap NUMERIC(6,3),
  risk_score           NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_blocked           BOOLEAN NOT NULL DEFAULT false,
  block_reason         TEXT,
  flagged_reason       TEXT,
  first_seen_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX seller_entities_phone_idx ON seller_entities (phone_hash);
CREATE INDEX seller_entities_risk_idx  ON seller_entities (risk_score DESC) WHERE NOT is_blocked;
CREATE INDEX seller_entities_name_trgm ON seller_entities USING gin (name_norm_hash gin_trgm_ops);

CREATE TABLE seller_entity_sightings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_entity_id  UUID REFERENCES seller_entities(id) ON DELETE SET NULL,
  transaction_id UUID NOT NULL,          -- FK added below: evidence_objects -> transactions
  agent_id          UUID NOT NULL REFERENCES agent_profiles(user_id),
  sighting_kind     TEXT NOT NULL CHECK (sighting_kind IN ('first','repeat','independent','flagged')),
  declared_city_id  UUID REFERENCES cities(id),
  verified_city_id  UUID REFERENCES cities(id),
  gps               geography(Point, 4326),
  location_offset_m INTEGER,
  possession_result TEXT NOT NULL CHECK (possession_result IN ('verified','partial','none','contradicted')),
  object_ids        UUID[] NOT NULL DEFAULT '{}',
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ses_txn_idx ON seller_entity_sightings (transaction_id);
CREATE INDEX ses_entity_idx ON seller_entity_sightings (seller_entity_id, created_at DESC);
```

---

## 7. Evidence — the immutable core

```sql
CREATE TABLE evidence_objects (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID,                   -- null pre-conversion. FK added below -> transactions
  request_id     UUID REFERENCES requests(id) ON DELETE SET NULL,
  uploaded_by    UUID NOT NULL REFERENCES users(id),
  kind           evidence_kind NOT NULL,
  storage_key    TEXT NOT NULL UNIQUE,             -- s3:// key; WORM bucket
  storage_class  TEXT NOT NULL DEFAULT 'standard',
  mime_type      TEXT NOT NULL,
  bytes          INTEGER NOT NULL,
  width          INTEGER, height INTEGER, duration_ms INTEGER,
  -- client-declared vs server-computed. Mismatch => tampering signal.
  client_sha256  TEXT,
  server_sha256  TEXT NOT NULL,
  phash          TEXT,                             -- 64-bit perceptual hash, hex
  exif_stripped  BOOLEAN NOT NULL DEFAULT false,
  capture_app    TEXT NOT NULL DEFAULT 'unknown',  -- 'app_capture','import','courier_webhook','ops'
  integrity      TEXT NOT NULL DEFAULT 'unverified'
        CHECK (integrity IN ('unverified','verified','client_hash_mismatch','quarantined')),
  captured_at    TIMESTAMPTZ NOT NULL,
  captured_gps   geography(Point, 4326),
  gps_accuracy_m INTEGER,
  device_id      UUID REFERENCES user_devices(id),
  device_time    TIMESTAMPTZ,
  server_time    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ocr_text       TEXT,
  redacted       BOOLEAN NOT NULL DEFAULT false,
  legal_hold     BOOLEAN NOT NULL DEFAULT false,
  tombstoned     BOOLEAN NOT NULL DEFAULT false,
  tombstone_reason TEXT,
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT evidence_server_hash_required CHECK (length(server_sha256) = 64)
);
CREATE INDEX evidence_txn_idx    ON evidence_objects (transaction_id, captured_at);
CREATE INDEX evidence_phash_idx  ON evidence_objects (phash);
CREATE INDEX evidence_gps_idx    ON evidence_objects USING gist (captured_gps);
CREATE INDEX evidence_hash_idx   ON evidence_objects (server_sha256);
CREATE INDEX evidence_live_idx   ON evidence_objects (integrity) WHERE integrity <> 'verified';
CREATE INDEX evidence_time_idx   ON evidence_objects (server_time DESC);
-- Same phash seen more than once across different actors = fabricated/reused evidence.
CREATE INDEX evidence_dup_idx    ON evidence_objects (phash, uploaded_by);

-- Immutability: no UPDATE and no DELETE ever.
CREATE OR REPLACE FUNCTION evidence_is_immutable() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.tombstoned IS FALSE THEN
    RAISE EXCEPTION 'evidence_objects is append-only; set tombstoned=true instead';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.server_sha256 IS DISTINCT FROM NEW.server_sha256
       OR OLD.captured_at IS DISTINCT FROM NEW.captured_at THEN
      RAISE EXCEPTION 'evidence integrity fields are immutable';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_immutable
  BEFORE UPDATE OR DELETE ON evidence_objects
  FOR EACH ROW EXECUTE FUNCTION evidence_is_immutable();

CREATE TABLE evidence_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id       UUID NOT NULL REFERENCES evidence_objects(id) ON DELETE CASCADE,
  transaction_id  UUID,                  -- FK added below: evidence_links -> transactions
  inspection_item_id UUID,               -- FK added below: evidence_links -> inspection_items
  dispute_id      UUID,                  -- FK added below: evidence_links -> disputes
  seller_sighting_id UUID REFERENCES seller_entity_sightings(id) ON DELETE CASCADE,
  actor_id        UUID NOT NULL REFERENCES users(id),
  purpose         TEXT NOT NULL,
  visible_to      TEXT[] NOT NULL DEFAULT '{buyer,agent}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX evidence_links_obj_idx ON evidence_links (object_id);
CREATE INDEX evidence_links_txn_idx ON evidence_links (transaction_id);
```

---

## 8. Transactions

```sql
CREATE TABLE transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_ref          TEXT NOT NULL UNIQUE DEFAULT ('FA-' || upper(substr(encode(gen_random_bytes(6),'hex'),1,8))),
  request_id          UUID NOT NULL UNIQUE REFERENCES requests(id),
  offer_id            UUID NOT NULL REFERENCES offers(id),
  buyer_id            UUID NOT NULL REFERENCES users(id),
  agent_id            UUID NOT NULL REFERENCES agent_profiles(user_id),
  seller_entity_id    UUID REFERENCES seller_entities(id),
  state               txn_state NOT NULL DEFAULT 'awaiting_bid_payment',
  state_version       INTEGER NOT NULL DEFAULT 0,        -- optimistic lock
  state_entered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  settlement_mode     TEXT NOT NULL DEFAULT 'direct_to_seller'
        CHECK (settlement_mode IN ('direct_to_seller','psp_escrow','ops_assisted')),
  currency            CHAR(3) NOT NULL DEFAULT 'PKR',

  -- Money. Never merged. `purchase_price_minor` is REFERENCE ONLY -- it is the price both
  -- sides agreed on camera. It never passes through our ledger; only the fees below do
  -- (DECISIONS.md section 4, section 7).
  bid_minor             BIGINT NOT NULL CHECK (bid_minor > 0),      -- the buyer's bid, frozen
  travel_fee_minor      BIGINT NOT NULL DEFAULT 0 CHECK (travel_fee_minor >= 0),
  purchase_price_minor  BIGINT NOT NULL DEFAULT 0 CHECK (purchase_price_minor >= 0),
  buyer_fee_minor       BIGINT NOT NULL DEFAULT 0 CHECK (buyer_fee_minor  >= 0),  -- 5%, 1.5k-15k
  seller_fee_minor      BIGINT NOT NULL DEFAULT 0 CHECK (seller_fee_minor >= 0),  -- 3%, 1k-8k
  dealer_bonus_minor    BIGINT NOT NULL DEFAULT 0 CHECK (dealer_bonus_minor >= 0),-- 2%, 1k-5k
  company_take_minor    BIGINT NOT NULL DEFAULT 0 CHECK (company_take_minor >= 0),-- the remainder
  milestone_released_minor BIGINT NOT NULL DEFAULT 0,

  -- Authority envelope: the inspection may never authorise a price above this.
  max_authorized_minor BIGINT NOT NULL,
  negotiation_target_minor BIGINT,

  -- Milestones (independent booleans, not derived, for idempotent release)
  m1_earned_at TIMESTAMPTZ, m2_earned_at TIMESTAMPTZ, m3_earned_at TIMESTAMPTZ,
  m4_earned_at TIMESTAMPTZ, m5_earned_at TIMESTAMPTZ,

  -- Timestamps that gate money. The commission trigger reads these.
  bid_paid_at               TIMESTAMPTZ,   -- buyer paid the bid in-app: the dealer may travel
  agent_accepted_at         TIMESTAMPTZ,
  arrived_at                TIMESTAMPTZ,
  seller_verified_at        TIMESTAMPTZ,
  seller_fee_collected_at   TIMESTAMPTZ,   -- seller's 3% taken on site, on camera
  possession_confirmed_at   TIMESTAMPTZ,
  inspection_completed_at   TIMESTAMPTZ,
  purchase_authorized_at    TIMESTAMPTZ,
  purchase_completed_at     TIMESTAMPTZ,   -- success fee chargeable ONLY if NOT NULL
  custody_verified_at       TIMESTAMPTZ,
  delivered_at              TIMESTAMPTZ,
  buyer_confirmed_at        TIMESTAMPTZ,
  dispute_window_ends_at    TIMESTAMPTZ,
  commission_settled_at     TIMESTAMPTZ,
  closed_at                 TIMESTAMPTZ,

  failure_reason     TEXT,
  failure_detail     TEXT,
  has_open_dispute   BOOLEAN NOT NULL DEFAULT false,
  risk_score         NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_at_risk         BOOLEAN NOT NULL DEFAULT false,
  insurance_policy_ref TEXT,
  courier_partner_id UUID,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT txn_fees_reconcile CHECK (
      company_take_minor = buyer_fee_minor + seller_fee_minor - dealer_bonus_minor),
  -- Nothing is chargeable, and nothing is payable to the dealer as a success bonus, unless
  -- a purchase actually completed. Layer 1 of the guarantee; the trigger is layer 2 (06 section 3.2).
  CONSTRAINT txn_no_success_fee_unless_closed CHECK (
      (buyer_fee_minor = 0 AND seller_fee_minor = 0
       AND dealer_bonus_minor = 0 AND company_take_minor = 0)
      OR purchase_completed_at IS NOT NULL),
  CONSTRAINT txn_price_within_authority CHECK (
      purchase_price_minor = 0 OR purchase_price_minor <= max_authorized_minor
                              OR negotiation_target_minor IS NULL)
);
CREATE INDEX txn_state_idx    ON transactions (state, state_entered_at);
CREATE INDEX txn_buyer_idx    ON transactions (buyer_id, created_at DESC);
CREATE INDEX txn_agent_idx    ON transactions (agent_id, state);
CREATE INDEX txn_open_idx     ON transactions (buyer_id) WHERE state NOT IN
       ('transaction_completed','deal_failed','bid_refunded','cancelled_by_buyer','expired_request');
CREATE INDEX txn_sla_due_idx  ON transactions (state_entered_at)
       WHERE state IN ('agent_selected','awaiting_bid_payment','settlement_pending','delivered');
CREATE INDEX txn_risk_idx     ON transactions (risk_score DESC) WHERE risk_score >= 40;

CREATE TABLE transaction_parties (
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('buyer','agent','seller','courier')),
  user_id        UUID REFERENCES users(id),
  external_ref   TEXT,
  contact_enc    BYTEA,
  PRIMARY KEY (transaction_id, role)
);

CREATE TABLE transaction_events (
  id             BIGSERIAL PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  from_state     txn_state,
  to_state       txn_state NOT NULL,
  event_type     TEXT NOT NULL,
  actor_id       UUID REFERENCES users(id),
  actor_role     TEXT,
  payload        JSONB NOT NULL DEFAULT '{}',
  guard_failures TEXT[],
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, seq)
);
CREATE INDEX txn_events_txn_idx ON transaction_events (transaction_id, seq);
```

### The financial invariant, enforced by the database

```sql
-- Structural guarantee: commission cannot be recorded on a transaction that never completed
-- a purchase. This is the answer to "how do we guarantee the 10% is never charged on a
-- cancelled deal" — it does not rely on the application being correct.
CREATE OR REPLACE FUNCTION commission_requires_completed_purchase() RETURNS TRIGGER AS $$
DECLARE t transactions;
BEGIN
  SELECT * INTO t FROM transactions WHERE id = NEW.transaction_id;
  IF NEW.account_kind = 'revenue' THEN
    IF t.purchase_completed_at IS NULL THEN
      RAISE EXCEPTION 'commission revenue blocked: purchase_completed_at IS NULL (txn %, state %)',
        t.public_ref, t.state;
    END IF;
    IF t.has_open_dispute THEN
      RAISE EXCEPTION 'commission revenue blocked: open dispute on txn %', t.public_ref;
    END IF;
    IF t.dispute_window_ends_at IS NOT NULL AND now() < t.dispute_window_ends_at THEN
      RAISE EXCEPTION 'commission revenue blocked: dispute window open on txn %', t.public_ref;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_commission_guard
  BEFORE INSERT ON ledger_postings
  FOR EACH ROW EXECUTE FUNCTION commission_requires_completed_purchase();

-- Double-entry integrity: each entry's postings must net to zero.
CREATE OR REPLACE FUNCTION ledger_entry_balances() RETURNS TRIGGER AS $$
DECLARE total BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_minor),0) INTO total
    FROM ledger_postings WHERE entry_id = NEW.entry_id;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger entry % is unbalanced (net %)', NEW.entry_id, total;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_balance_check
  AFTER INSERT ON ledger_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_balances();
```

---

## 9. Inspection, negotiation, live session, custody, logistics

```sql
CREATE TABLE inspections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  template_id      UUID REFERENCES checklist_templates(id),
  template_version INTEGER,
  verdict          verdict,
  verdict_notes    TEXT,
  checklist_complete BOOLEAN NOT NULL DEFAULT false,
  declared_vs_verified_diff JSONB NOT NULL DEFAULT '{}',
  discrepancy_acknowledged_at TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  submitted_at     TIMESTAMPTZ,
  sealed_at        TIMESTAMPTZ,
  sealed_hash      TEXT,
  amended          BOOLEAN NOT NULL DEFAULT false,
  amend_reason     TEXT,
  client_draft     JSONB NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inspection_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  section       TEXT NOT NULL,
  label         TEXT NOT NULL,
  position      INTEGER NOT NULL,
  status        check_status NOT NULL DEFAULT 'na',
  value_number  NUMERIC,
  value_text    TEXT,
  notes         TEXT,
  skipped_reason TEXT,
  media_count   SMALLINT NOT NULL DEFAULT 0,
  captured_at   TIMESTAMPTZ,
  device_time   TIMESTAMPTZ,
  UNIQUE (inspection_id, key)
);
CREATE INDEX insp_items_insp_idx ON inspection_items (inspection_id, section, position);

CREATE TABLE serials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  serial_type       TEXT NOT NULL CHECK (serial_type IN ('imei','serial','vin','mtin','other')),
  value_enc         BYTEA NOT NULL,
  value_hash        TEXT NOT NULL,                    -- for exact match
  value_norm_hash   TEXT NOT NULL,                    -- fuzzy/luhn-normalised
  value_last4       CHAR(4) NOT NULL,
  read_at_inspection TIMESTAMPTZ,
  read_at_custody   TIMESTAMPTZ,
  custody_match     BOOLEAN,                          -- MUST be true to leave custody_verified
  blacklist_status  TEXT NOT NULL DEFAULT 'unchecked'
          CHECK (blacklist_status IN ('unchecked','clean','hit','unavailable')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX serials_txn_idx   ON serials (transaction_id);
CREATE INDEX serials_hash_idx  ON serials (value_hash);
CREATE INDEX serials_norm_idx  ON serials (value_norm_hash);
CREATE INDEX serials_blacklist ON serials (value_norm_hash) WHERE blacklist_status = 'hit';

CREATE TABLE check_ins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  actor_id       UUID NOT NULL REFERENCES users(id),
  kind           TEXT NOT NULL CHECK (kind IN ('arrival','departure','safe_point','sos')),
  gps            geography(Point, 4326) NOT NULL,
  accuracy_m     INTEGER NOT NULL,
  address_text   TEXT,
  object_id      UUID REFERENCES evidence_objects(id),
  attestation    TEXT,
  trusted_contact_notified BOOLEAN NOT NULL DEFAULT false,
  within_service_area BOOLEAN,
  offset_from_seller_m INTEGER,
  device_id      UUID REFERENCES user_devices(id),
  device_time    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX check_ins_txn_idx ON check_ins (transaction_id, created_at);
CREATE INDEX check_ins_gps_idx ON check_ins USING gist (gps);

CREATE TABLE negotiation_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  kind           negotiation_kind NOT NULL,
  amount_minor   BIGINT,
  counterparty   TEXT NOT NULL CHECK (counterparty IN ('seller','buyer')),
  actor_id       UUID REFERENCES users(id),
  message        TEXT,
  object_ids     UUID[] NOT NULL DEFAULT '{}',
  live_session_id UUID,                  -- FK added below: negotiation_events -> live_sessions
  buyer_override BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT neg_no_zero CHECK (amount_minor IS NULL OR amount_minor > 0)
);
CREATE INDEX neg_txn_idx ON negotiation_events (transaction_id, created_at);

CREATE TABLE live_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'livekit',
  room_name        TEXT NOT NULL UNIQUE,
  started_by       UUID NOT NULL REFERENCES users(id),
  required         BOOLEAN NOT NULL DEFAULT false,
  completed        BOOLEAN NOT NULL DEFAULT false,
  buyer_consented_at TIMESTAMPTZ,
  agent_consented_at TIMESTAMPTZ,
  recording_enabled BOOLEAN NOT NULL DEFAULT true,
  recording_object_id UUID REFERENCES evidence_objects(id),
  duration_ms      INTEGER,
  ended_reason     TEXT CHECK (ended_reason IN ('agent','buyer','timeout','network','abandoned')),
  participant_meta JSONB NOT NULL DEFAULT '{}',
  screen_share_events JSONB NOT NULL DEFAULT '[]',
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ
);
CREATE INDEX live_txn_idx ON live_sessions (transaction_id);
-- Mandatory live sessions must be satisfied before settlement.
CREATE INDEX live_required_open ON live_sessions (transaction_id) WHERE required AND NOT completed;

CREATE TABLE packages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  sealed_at         TIMESTAMPTZ,
  packaging_type    TEXT,
  weight_kg         NUMERIC(7,3),
  dims_cm           TEXT,
  declared_value_minor BIGINT NOT NULL CHECK (declared_value_minor >= 0),
  insured           BOOLEAN NOT NULL DEFAULT false,
  insurance_ref     TEXT,
  tamper_seal_ref   TEXT,
  object_ids        UUID[] NOT NULL DEFAULT '{}',
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shipments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id      UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  courier_partner_id  UUID,              -- FK added below: shipments -> courier_partners
  mode                shipment_mode NOT NULL,
  status              shipment_status NOT NULL DEFAULT 'label_created',
  waybill             TEXT UNIQUE,
  courier_reference   TEXT,
  pickup_object_id    UUID REFERENCES evidence_objects(id),
  handover_at         TIMESTAMPTZ,
  handover_latency_ok BOOLEAN,
  picked_up_at        TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  pod_object_id       UUID REFERENCES evidence_objects(id),
  receiver_name       TEXT,
  receiver_relation   TEXT CHECK (receiver_relation IN ('buyer','family','neighbour','other')),
  receiver_otp_hash   TEXT,
  agent_delivered_by  UUID REFERENCES agent_profiles(user_id),
  insurance_policy_ref TEXT,
  last_tracking       JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shipments_txn_idx    ON shipments (transaction_id);
CREATE INDEX shipments_status_idx ON shipments (status, updated_at DESC);
CREATE INDEX shipments_waybill_idx ON shipments (waybill) WHERE waybill IS NOT NULL;

CREATE TABLE shipment_events (
  id           BIGSERIAL PRIMARY KEY,
  shipment_id  UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  provider_event_id TEXT,
  type         TEXT NOT NULL,
  status       shipment_status NOT NULL,
  location_text TEXT,
  payload      JSONB NOT NULL DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX shipment_events_ship_idx ON shipment_events (shipment_id, occurred_at);
```

---

## 10. Money: payments, double-entry ledger, payouts

```sql
CREATE TABLE payments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    UUID REFERENCES transactions(id) ON DELETE CASCADE,
  purpose           payment_purpose NOT NULL,
  method            payment_method NOT NULL,
  provider          TEXT NOT NULL,
  provider_txn_id   TEXT,
  provider_order_id TEXT,
  payer_user_id     UUID REFERENCES users(id),
  payee_ref         TEXT,
  amount_minor      BIGINT NOT NULL CHECK (amount_minor >= 0),
  fee_minor         BIGINT NOT NULL DEFAULT 0,
  tax_minor         BIGINT NOT NULL DEFAULT 0,
  net_minor         BIGINT NOT NULL,
  currency          CHAR(3) NOT NULL DEFAULT 'PKR',
  status            payment_status NOT NULL DEFAULT 'created',
  idempotency_key   TEXT NOT NULL,
  ledger_entry_id   UUID,
  raw               JSONB NOT NULL DEFAULT '{}',
  signature_verified BOOLEAN NOT NULL DEFAULT false,
  failure_code      TEXT,
  failure_message   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_at       TIMESTAMPTZ,
  UNIQUE (provider, provider_txn_id),
  UNIQUE (idempotency_key)
);
CREATE INDEX payments_txn_idx  ON payments (transaction_id, purpose);
CREATE INDEX payments_status_idx ON payments (status, created_at DESC) WHERE status IN ('created','pending');

CREATE TABLE ledger_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  kind         ledger_account_kind NOT NULL,
  currency     CHAR(3) NOT NULL DEFAULT 'PKR',
  parent_id    UUID REFERENCES ledger_accounts(id),
  is_postable  BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT revenue_not_postable CHECK (not (kind = 'revenue' and is_postable))
);

CREATE TABLE ledger_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference      TEXT NOT NULL,
  txn_ref        TEXT,                                -- transactions.public_ref
  transaction_id UUID REFERENCES transactions(id),
  kind           TEXT NOT NULL CHECK (kind IN
        ('task_fee_reserved','task_fee_released','bid_refunded','success_fee_charged',
         'success_fee_split','payout','refund','adjustment','dispute_remedy','chargeback','fee_expense')),
  description    TEXT,
  posted_by      UUID REFERENCES users(id),
  reversal_of    UUID REFERENCES ledger_entries(id),
  posted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (reference)
);
CREATE INDEX ledger_entries_txn_idx ON ledger_entries (transaction_id, posted_at);

CREATE TABLE ledger_postings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id       UUID NOT NULL REFERENCES ledger_entries(id) ON DELETE RESTRICT,
  transaction_id UUID REFERENCES transactions(id),
  account_id     UUID NOT NULL REFERENCES ledger_accounts(id),
  direction      TEXT NOT NULL CHECK (direction IN ('debit','credit')),
  amount_minor   BIGINT NOT NULL CHECK (amount_minor >= 0),
  account_kind   ledger_account_kind NOT NULL,        -- denormalised for the guard trigger
  memo           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT postings_sign CHECK (
      (direction = 'debit'  AND account_kind IN ('asset','expense'))
   OR (direction = 'credit' AND account_kind IN ('liability','equity','revenue'))
   OR (direction IN ('debit','credit'))              -- contra/reflexive accounts
  )
);
CREATE INDEX postings_entry_idx ON ledger_postings (entry_id);
CREATE INDEX postings_acct_idx   ON ledger_postings (account_id, created_at DESC);
CREATE INDEX postings_txn_idx    ON ledger_postings (transaction_id);
-- No UPDATE or DELETE, ever.
CREATE RULE ledger_postings_no_update AS ON UPDATE TO ledger_postings DO INSTEAD NOTHING;
CREATE RULE ledger_postings_no_delete AS ON DELETE TO ledger_postings DO INSTEAD NOTHING;

CREATE TABLE payout_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date     DATE NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','approved','processing','completed','failed','reversed')),
  total_minor  BIGINT NOT NULL DEFAULT 0,
  agent_count  INTEGER NOT NULL DEFAULT 0,
  approved_by  UUID REFERENCES users(id),
  approved_at  TIMESTAMPTZ,
  provider_ref TEXT,
  reconciliation JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payout_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_run_id  UUID NOT NULL REFERENCES payout_runs(id) ON DELETE CASCADE,
  agent_id       UUID NOT NULL REFERENCES agent_profiles(user_id),
  amount_minor   BIGINT NOT NULL CHECK (amount_minor > 0),
  payout_account_id UUID NOT NULL REFERENCES payout_accounts(id),
  bank_name      TEXT NOT NULL,
  iban_last4     CHAR(4) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','sent','settled','failed','reversed')),
  provider_txn_id TEXT,
  failure_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at     TIMESTAMPTZ,
  UNIQUE (payout_run_id, agent_id)
);
CREATE INDEX payout_items_agent_idx ON payout_items (agent_id, status);
```

### Chart of accounts (seed)

| code | name | kind |
|---|---|---|
| `1000` | Cash & bank (PSP clearing) | asset |
| `1100` | Funds in transit from PSP | asset |
| `1200` | Dispute provision | contra |
| `2000` | Buyer inspection bids reserved | liability |
| `2100` | Refunds payable | liability |
| `2200` | Agent payables (earned, unpaid) | liability |
| `2300` | Dispute awards payable | liability |
| `3000` | Owner equity | equity |
| `4000` | Success fee revenue | revenue |
| `4900` | Success fee refunds (contra) | revenue |
| `5000` | PSP processing fees | expense |
| `5100` | Courier costs | expense |
| `5200` | Dispute payouts | expense |
| `5300` | Fraud losses | expense |

---

## 11. Trust, disputes, ratings, risk

```sql
CREATE TABLE disputes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id    UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  public_ref        TEXT NOT NULL UNIQUE,
  opened_by         UUID NOT NULL REFERENCES users(id),
  opened_by_role    dispute_party_role NOT NULL,
  respondent_role   dispute_party_role NOT NULL,
  reason            dispute_reason NOT NULL,
  description       TEXT NOT NULL,
  requested_remedy  dispute_remedy,
  claimed_amount_minor BIGINT,
  status            dispute_status NOT NULL DEFAULT 'open',
  priority          SMALLINT NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  assigned_to       UUID REFERENCES users(id),
  frozen_commission BOOLEAN NOT NULL DEFAULT true,
  first_response_due_at TIMESTAMPTZ NOT NULL,
  resolution_due_at      TIMESTAMPTZ NOT NULL,
  resolution        TEXT,
  remedy            dispute_remedy,
  remedy_amount_minor BIGINT,
  resolved_by       UUID REFERENCES users(id),
  resolved_at       TIMESTAMPTZ,
  appealed_at       TIMESTAMPTZ,
  root_cause        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT disputes_self_party CHECK (opened_by_role <> respondent_role)
);
CREATE INDEX disputes_txn_idx  ON disputes (transaction_id);
CREATE INDEX disputes_sla_idx  ON disputes (resolution_due_at) WHERE status NOT IN ('resolved','closed');
CREATE INDEX disputes_queue_idx ON disputes (status, priority, first_response_due_at);

CREATE TABLE dispute_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id   UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  author_id    UUID REFERENCES users(id),
  author_role  dispute_party_role NOT NULL,
  body         TEXT NOT NULL,
  internal     BOOLEAN NOT NULL DEFAULT false,       -- staff-only notes
  object_ids   UUID[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dispute_messages_idx ON dispute_messages (dispute_id, created_at);

CREATE TABLE dispute_appeals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  UUID NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  filed_by    UUID NOT NULL REFERENCES users(id),
  grounds     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  outcome     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE ratings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  rater_id      UUID NOT NULL REFERENCES users(id),
  ratee_id      UUID NOT NULL REFERENCES users(id),
  ratee_role    TEXT NOT NULL CHECK (ratee_role IN ('agent','buyer')),
  overall       SMALLINT NOT NULL CHECK (overall BETWEEN 1 AND 5),
  communication SMALLINT CHECK (communication BETWEEN 1 AND 5),
  thoroughness  SMALLINT CHECK (thoroughness BETWEEN 1 AND 5),
  punctuality   SMALLINT CHECK (punctuality BETWEEN 1 AND 5),
  honesty       SMALLINT CHECK (honesty BETWEEN 1 AND 5),
  safety        SMALLINT CHECK (safety BETWEEN 1 AND 5),
  would_rebook  BOOLEAN,
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ratings_one_per_rater UNIQUE (transaction_id, rater_id),
  CONSTRAINT ratings_no_self CHECK (rater_id <> ratee_id)
);
CREATE INDEX ratings_ratee_idx ON ratings (ratee_id, created_at DESC);
-- Ratings are only valid against completed transactions. Enforced:
CREATE OR REPLACE FUNCTION rating_requires_completion() RETURNS TRIGGER AS $$
DECLARE st txn_state;
BEGIN
  SELECT state INTO st FROM transactions WHERE id = NEW.transaction_id;
  IF st <> 'transaction_completed' THEN
    RAISE EXCEPTION 'rating blocked: transaction is %, must be transaction_completed', st;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER ratings_completion_gate
  BEFORE INSERT ON ratings FOR EACH ROW EXECUTE FUNCTION rating_requires_completion();

CREATE TABLE risk_signals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type  subject_type NOT NULL,
  subject_id    UUID NOT NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  code          risk_signal_code NOT NULL,
  score         SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  detail        JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','reviewed','confirmed','dismissed','escalated')),
  reviewed_by   UUID REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_type, subject_id, code, transaction_id)
);
CREATE INDEX risk_signals_subject_idx ON risk_signals (subject_type, subject_id, score DESC);
CREATE INDEX risk_signals_txn_idx    ON risk_signals (transaction_id);
CREATE INDEX risk_signals_open_idx   ON risk_signals (score DESC) WHERE status = 'open';

CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   UUID NOT NULL REFERENCES users(id),
  subject_type  subject_type NOT NULL,
  subject_id    UUID NOT NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  description   TEXT NOT NULL,
  object_ids    UUID[] NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'open',
  handled_by    UUID REFERENCES users(id),
  handled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_subject_idx ON reports (subject_type, subject_id, status);

CREATE TABLE moderation_cases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         moderation_kind NOT NULL,
  status       moderation_status NOT NULL DEFAULT 'open',
  subject_type subject_type NOT NULL,
  subject_id   UUID NOT NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  priority     SMALLINT NOT NULL DEFAULT 3,
  reason       TEXT NOT NULL,
  assigned_to  UUID REFERENCES users(id),
  sla_due_at   TIMESTAMPTZ NOT NULL,
  resolution   TEXT,
  action_taken TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at    TIMESTAMPTZ
);
CREATE INDEX moderation_queue_idx ON moderation_cases (status, priority, sla_due_at);

CREATE TABLE saved_agents (
  buyer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id   UUID NOT NULL REFERENCES agent_profiles(user_id) ON DELETE CASCADE,
  nickname   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (buyer_id, agent_id)
);
```

---

## 12. Messaging, notifications, integrations, ops

```sql
CREATE TABLE messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  sender_id      UUID NOT NULL REFERENCES users(id),
  body           TEXT NOT NULL,
  object_ids     UUID[] NOT NULL DEFAULT '{}',
  kind           TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','system','file')),
  is_retained_evidence BOOLEAN NOT NULL DEFAULT true,
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_txn_idx ON messages (transaction_id, created_at);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     notif_channel NOT NULL,
  template    TEXT NOT NULL,
  params      JSONB NOT NULL DEFAULT '{}',
  locale      TEXT NOT NULL DEFAULT 'en-PK',
  status      notif_status NOT NULL DEFAULT 'queued',
  provider_ref TEXT,
  attempts    SMALLINT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  error       TEXT,
  transaction_id UUID REFERENCES transactions(id) ON DELETE CASCADE,
  template_key TEXT GENERATED ALWAYS AS
      (template || ':' || coalesce(transaction_id::text,'')) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ,
  read_at     TIMESTAMPTZ,
  UNIQUE (user_id, channel, template_key)
);
CREATE INDEX notifications_user_idx  ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_retry_idx ON notifications (next_retry_at) WHERE status = 'queued';

CREATE TABLE notification_templates (
  code        TEXT NOT NULL,
  channel     notif_channel NOT NULL,
  locale      TEXT NOT NULL,
  subject     TEXT,
  body        TEXT NOT NULL,
  variables   TEXT[] NOT NULL DEFAULT '{}',
  severity    SMALLINT NOT NULL DEFAULT 3 CHECK (severity BETWEEN 1 AND 5),
  sms_rationed BOOLEAN NOT NULL DEFAULT false,  -- true = one of the four cost-bearing SMS events
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (code, channel, locale)
);

CREATE TABLE courier_partners (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  country_code  CHAR(2) NOT NULL DEFAULT 'PK',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  supports_cod  BOOLEAN NOT NULL DEFAULT false,
  supports_insurance BOOLEAN NOT NULL DEFAULT false,
  max_declared_value_minor BIGINT,
  config        JSONB NOT NULL DEFAULT '{}',    -- credentials via secret manager ref
  priority      SMALLINT NOT NULL DEFAULT 10,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  seq          BIGSERIAL,
  actor_id     UUID,
  actor_role   TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  before       JSONB,
  after        JSONB,
  reason       TEXT,
  ip           INET,
  user_agent   TEXT,
  request_id   TEXT,
  prev_hash    TEXT NOT NULL,
  entry_hash   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity_type, entity_id, id DESC);
CREATE INDEX audit_actor_idx  ON audit_log (actor_id, id DESC);
CREATE RULE audit_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

CREATE OR REPLACE FUNCTION audit_chain() RETURNS TRIGGER AS $$
DECLARE prev TEXT; h TEXT;
BEGIN
  SELECT entry_hash INTO prev FROM audit_log ORDER BY id DESC LIMIT 1;
  h := encode(digest(
    coalesce(prev,'') || coalesce(NEW.actor_id::text,'') || NEW.action ||
    NEW.entity_type || NEW.entity_id || coalesce(NEW.before::text,'') ||
    coalesce(NEW.after::text,'') || NEW.created_at::text, 'sha256'), 'hex');
  NEW.prev_hash  := coalesce(prev, '');
  NEW.entry_hash := h;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER audit_hash_chain BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_chain();

CREATE TABLE idempotency_keys (
  key           TEXT PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  endpoint      TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_code INTEGER,
  response_body JSONB,
  locked_until  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idem_sweep_idx ON idempotency_keys (created_at);

CREATE TABLE outbox_events (
  id             BIGSERIAL PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id   UUID NOT NULL,
  event_type     TEXT NOT NULL,
  payload        JSONB NOT NULL,
  headers        JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ,
  attempts       SMALLINT NOT NULL DEFAULT 0,
  next_retry_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error     TEXT
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (next_retry_at) WHERE published_at IS NULL;

CREATE TABLE analytics_events (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL,
  user_id        UUID,
  user_role      TEXT,
  session_id     TEXT,
  city_id        UUID,
  transaction_id UUID,
  request_id     UUID,
  state_from     txn_state,
  state_to       txn_state,
  properties     JSONB NOT NULL DEFAULT '{}',
  platform       TEXT,
  app_version    TEXT
) PARTITION BY RANGE (occurred_at);
CREATE TABLE analytics_events_2026m01 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE analytics_events_2026m02 PARTITION OF analytics_events
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE INDEX analytics_name_idx ON analytics_events (name, occurred_at DESC);
CREATE INDEX analytics_txn_idx  ON analytics_events (transaction_id) WHERE transaction_id IS NOT NULL;

CREATE TABLE feature_flags (
  key        TEXT NOT NULL,
  variant    TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  rules      JSONB NOT NULL DEFAULT '{}',      -- {segments:[{attr,op,value}]}
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (key, variant)
);

CREATE TABLE saved_searches_and_misc (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 13. Useful views

```sql
-- Agent earnings, derived from the ledger only (never from a stored counter).
CREATE VIEW v_agent_earnings AS
SELECT p.user_id AS agent_id,
       date_trunc('week', l.posted_at) AS week,
       SUM(CASE WHEN a.kind = 'liability' THEN -lp.amount_minor ELSE lp.amount_minor END) AS earned_minor
FROM ledger_postings lp
JOIN ledger_entries l ON l.id = lp.entry_id
JOIN ledger_accounts a ON a.id = lp.account_id
WHERE a.code IN ('2200','4900')
GROUP BY 1,2;

-- Open work, by SLA risk.
CREATE VIEW v_txn_sla AS
SELECT t.public_ref, t.state, t.state_entered_at,
       EXTRACT(EPOCH FROM (now() - t.state_entered_at))::INT AS age_seconds,
       (SELECT r.status FROM risk_signals r
         WHERE r.transaction_id = t.id AND r.status='open' ORDER BY r.score DESC LIMIT 1) AS top_risk,
       (SELECT d.status FROM disputes d
         WHERE d.transaction_id = t.id ORDER BY d.created_at DESC LIMIT 1) AS dispute_status
FROM transactions t
WHERE t.state NOT IN ('transaction_completed','deal_failed','bid_refunded',
                      'cancelled_by_buyer','expired_request');

-- Success-fee health: should always be zero rows where purchase_completed_at IS NULL.
CREATE VIEW v_commission_anomaly AS
SELECT t.public_ref, t.state, lp.entry_id, lp.amount_minor
FROM ledger_postings lp
JOIN ledger_accounts a ON a.id = lp.account_id AND a.code = '4000'
JOIN transactions t ON t.id = lp.transaction_id
WHERE t.purchase_completed_at IS NULL;
```

---

## 13.5 Deferred foreign keys

Nine of the foreign keys above point at a table defined *later* in this file, or form a cycle
(`transactions` ↔ evidence, requests ↔ offers). PostgreSQL cannot create a table that
references a table which does not exist yet, so those constraints are added here, after every
table exists.

**This is not optional bookkeeping.** A migration that omits this block creates tables with no
referential integrity on evidence and transaction links — which is precisely the surface where
silent data corruption would be most expensive.

```sql
-- 1-table-later relationships
ALTER TABLE agent_category_skills
  ADD CONSTRAINT fk_acs_category FOREIGN KEY (category_id) REFERENCES categories(id);
ALTER TABLE request_evidence
  ADD CONSTRAINT fk_request_evidence_object
  FOREIGN KEY (object_id) REFERENCES evidence_objects(id);
ALTER TABLE negotiation_events
  ADD CONSTRAINT fk_neg_live_session
  FOREIGN KEY (live_session_id) REFERENCES live_sessions(id);

-- evidence <-> transaction cycle
ALTER TABLE evidence_objects
  ADD CONSTRAINT fk_evidence_txn
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
ALTER TABLE seller_entity_sightings
  ADD CONSTRAINT fk_sightings_txn
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;
ALTER TABLE evidence_links
  ADD CONSTRAINT fk_evlink_txn
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE;

-- evidence_links fan-out to tables defined much later
ALTER TABLE evidence_links
  ADD CONSTRAINT fk_evlink_inspection_item
  FOREIGN KEY (inspection_item_id) REFERENCES inspection_items(id) ON DELETE CASCADE;
ALTER TABLE evidence_links
  ADD CONSTRAINT fk_evlink_dispute
  FOREIGN KEY (dispute_id) REFERENCES disputes(id) ON DELETE CASCADE;

-- logistics
ALTER TABLE shipments
  ADD CONSTRAINT fk_shipment_courier
  FOREIGN KEY (courier_partner_id) REFERENCES courier_partners(id);
```

Verified with `tools/check_ddl.py`, which fails the build on any `REFERENCES` to a table defined
later in the file, on unbalanced parentheses in any SQL block, and on a `CHECK` or `UNIQUE`
constraint that references a column or condition PostgreSQL will reject.


---

## 14. Retention and partitioning

| Class | Retention | Notes |
|---|---|---|
| `audit_log` | 7 years | Legal hold overrides |
| `evidence_objects` (inspection) | 3 years | WORM bucket; legal hold extends |
| `evidence_objects` (dispute) | Life of dispute + 7 years | |
| `live_sessions` recording | 2 years | Consent-based; buyer may request earlier deletion unless disputed |
| `kyc_documents` | Life of account + 3 years after | Legal/AML; encrypted |
| `messages` | 3 years | |
| `analytics_events` | 25 months | Partitioned monthly; drop after |
| `seller_entities` | Indefinite | The risk corpus; minimal PII, hashed |
| `risk_signals` | 5 years | |

**PII separation:** `kyc_documents.doc_number_enc`, `seller_entities.name_enc`,
`transaction_parties.contact_enc` live in a restricted schema (`pii`) with a dedicated DB role
that only the KYC service, the T&S console (via brokered access), and crypto-shredding job may
read. Application logs never contain these fields — enforced by a log scrubber that fails CI
on field-name matches.