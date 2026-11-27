CREATE TABLE lists (id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'member'))
);
CREATE INDEX sessions_list ON sessions(list_id);
CREATE TABLE invites (
    token_hash TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lists(id),
    expires_at INTEGER NOT NULL
);
CREATE INDEX invites_list ON invites(list_id);
CREATE TABLE items (
    list_id TEXT NOT NULL REFERENCES lists(id),
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    photo TEXT NOT NULL DEFAULT '',
    added_at INTEGER NOT NULL,
    PRIMARY KEY (list_id, id)
);
CREATE TRIGGER items_insert_revision AFTER INSERT ON items
BEGIN
    UPDATE lists SET revision = revision + 1 WHERE id = NEW.list_id;
END;
CREATE TRIGGER items_update_revision AFTER UPDATE ON items
BEGIN
    UPDATE lists SET revision = revision + 1 WHERE id = NEW.list_id;
END;
CREATE TRIGGER items_delete_revision AFTER DELETE ON items
BEGIN
    UPDATE lists SET revision = revision + 1 WHERE id = OLD.list_id;
END;
