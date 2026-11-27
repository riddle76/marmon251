CREATE TABLE favorites (
    list_id TEXT NOT NULL REFERENCES lists(id),
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    product_key TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (list_id, id),
    UNIQUE (list_id, product_key)
);
CREATE TRIGGER favorites_insert_revision AFTER INSERT ON favorites
BEGIN
    UPDATE lists SET revision = revision + 1 WHERE id = NEW.list_id;
END;
CREATE TRIGGER favorites_delete_revision AFTER DELETE ON favorites
BEGIN
    UPDATE lists SET revision = revision + 1 WHERE id = OLD.list_id;
END;
