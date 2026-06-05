-- Prevents duplicate leads per workspace by normalized address.
-- Normalization: lowercase, collapse punctuation/spaces/# to a single space.
CREATE UNIQUE INDEX leads_workspace_address_unique_idx
ON leads (
  workspace_id,
  TRIM(LOWER(REGEXP_REPLACE(address, '[.,\s#]+', ' ', 'g')))
);
