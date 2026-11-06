CREATE TABLE IF NOT EXISTS decks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cards (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  ease_factor REAL NOT NULL DEFAULT 2.5,
  interval_days INTEGER NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE cards ADD COLUMN IF NOT EXISTS deck_id BIGINT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT '';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'basic';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS mastered BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS source_document_id TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS source_document_title TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS source_note_id TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS source_note_title TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

WITH legacy_decks AS (
  SELECT DISTINCT ON (lower(trim(COALESCE(NULLIF(topic, ''), 'General'))))
    trim(COALESCE(NULLIF(topic, ''), 'General')) AS name
  FROM cards
  ORDER BY lower(trim(COALESCE(NULLIF(topic, ''), 'General'))), id
)
INSERT INTO decks (name)
SELECT legacy.name
FROM legacy_decks AS legacy
WHERE NOT EXISTS (
  SELECT 1 FROM decks AS existing
  WHERE lower(trim(existing.name)) = lower(legacy.name)
);

INSERT INTO decks (name)
SELECT 'General'
WHERE NOT EXISTS (SELECT 1 FROM decks WHERE lower(name) = 'general');

UPDATE cards AS card
SET deck_id = deck.id,
    topic = deck.name,
    subject = COALESCE(NULLIF(card.subject, ''), deck.name)
FROM decks AS deck
WHERE card.deck_id IS NULL
  AND lower(trim(COALESCE(NULLIF(card.topic, ''), 'General'))) = lower(deck.name);

ALTER TABLE cards ALTER COLUMN deck_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cards_deck_id_fkey'
  ) THEN
    ALTER TABLE cards
      ADD CONSTRAINT cards_deck_id_fkey
      FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS decks_name_lower_idx ON decks (lower(name));

CREATE TABLE IF NOT EXISTS reviews (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  card_id BIGINT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_answer TEXT,
  score INTEGER NOT NULL,
  quality INTEGER NOT NULL,
  response_ms INTEGER,
  feedback TEXT
);

CREATE INDEX IF NOT EXISTS cards_due_at_idx ON cards (due_at);
CREATE INDEX IF NOT EXISTS cards_topic_idx ON cards (topic);
CREATE INDEX IF NOT EXISTS cards_deck_id_idx ON cards (deck_id);
CREATE INDEX IF NOT EXISTS cards_deleted_at_idx ON cards (deleted_at);
CREATE INDEX IF NOT EXISTS reviews_card_id_idx ON reviews (card_id);
CREATE INDEX IF NOT EXISTS reviews_reviewed_at_idx ON reviews (reviewed_at);

CREATE TABLE IF NOT EXISTS "session" (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" (expire);

CREATE TABLE IF NOT EXISTS assignment_workspaces (
  owner_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  assignment_data JSONB NOT NULL,
  brief_document_id TEXT,
  brief_file_name TEXT,
  brief_mime_type TEXT,
  brief_file_size BIGINT,
  brief_extracted_text TEXT,
  brief_status TEXT NOT NULL DEFAULT 'ready'
    CHECK (brief_status IN ('ready', 'needs_text')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, assignment_id),
  UNIQUE (owner_id, brief_document_id)
);

CREATE INDEX IF NOT EXISTS assignment_workspaces_owner_updated_idx
  ON assignment_workspaces (owner_id, updated_at DESC);
