-- Prefix search on member phone numbers (startsWith). text_pattern_ops lets the btree serve LIKE 'prefix%'
-- under any collation. Additive only: no data or existing index is changed.
CREATE INDEX "Member_phone_idx" ON "Member"("phone" text_pattern_ops);
