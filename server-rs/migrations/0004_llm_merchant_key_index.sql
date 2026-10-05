DROP INDEX idx_transactions_reviewed_merchant_category_datetime;
CREATE INDEX idx_transactions_reviewed_merchant_key_datetime
ON transactions(LTRIM(LOWER(COALESCE(NULLIF(merchant_name, ''), original_name))), datetime DESC, id DESC)
WHERE is_reviewed = 1;
