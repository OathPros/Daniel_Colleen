PRAGMA foreign_keys = ON;

CREATE TABLE parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE CHECK(length(public_id) >= 32),
  party_number INTEGER NOT NULL UNIQUE CHECK(party_number > 0),
  party_name TEXT NOT NULL CHECK(length(trim(party_name)) > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE guests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK(length(trim(full_name)) > 0),
  normalized_name TEXT NOT NULL,
  display_order INTEGER NOT NULL CHECK(display_order >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(party_id, display_order)
);
CREATE INDEX guests_normalized_name_idx ON guests(normalized_name);

CREATE TABLE party_rsvps (
  party_id INTEGER PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  contact_email TEXT NOT NULL,
  mailing_address_line1 TEXT NOT NULL,
  mailing_address_line2 TEXT,
  mailing_city TEXT NOT NULL,
  mailing_province_state TEXT NOT NULL,
  mailing_postal_code TEXT NOT NULL,
  mailing_country TEXT NOT NULL,
  message TEXT,
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE guest_rsvps (
  guest_id INTEGER PRIMARY KEY REFERENCES guests(id) ON DELETE CASCADE,
  attending TEXT NOT NULL CHECK(attending IN ('yes', 'no')),
  dinner_choice TEXT CHECK(dinner_choice IN ('beef', 'chicken', 'vegetarian')),
  dietary_restrictions TEXT,
  updated_at TEXT NOT NULL,
  CHECK((attending = 'yes' AND dinner_choice IS NOT NULL) OR
        (attending = 'no' AND dinner_choice IS NULL))
);
