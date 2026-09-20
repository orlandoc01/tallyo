CREATE VIRTUAL TABLE rules_fts USING fts5(
  merchant_name, merchant_pattern, original_pattern,
  content='rules', content_rowid='id',
  tokenize='unicode61'
);

INSERT INTO rules_fts(rules_fts) VALUES ('rebuild');

CREATE TRIGGER rules_fts_ad AFTER DELETE ON rules BEGIN
  INSERT INTO rules_fts(rules_fts, rowid, merchant_name, merchant_pattern, original_pattern)
  VALUES ('delete', old.id, old.merchant_name, old.merchant_pattern, old.original_pattern);
END;

CREATE TRIGGER rules_fts_ai AFTER INSERT ON rules BEGIN
  INSERT INTO rules_fts(rowid, merchant_name, merchant_pattern, original_pattern)
  VALUES (new.id, new.merchant_name, new.merchant_pattern, new.original_pattern);
END;

CREATE TRIGGER rules_fts_au
AFTER UPDATE OF merchant_name, merchant_pattern, original_pattern ON rules
WHEN old.merchant_name IS NOT new.merchant_name
  OR old.merchant_pattern IS NOT new.merchant_pattern
  OR old.original_pattern IS NOT new.original_pattern
BEGIN
  INSERT INTO rules_fts(rules_fts, rowid, merchant_name, merchant_pattern, original_pattern)
  VALUES ('delete', old.id, old.merchant_name, old.merchant_pattern, old.original_pattern);
  INSERT INTO rules_fts(rowid, merchant_name, merchant_pattern, original_pattern)
  VALUES (new.id, new.merchant_name, new.merchant_pattern, new.original_pattern);
END;
