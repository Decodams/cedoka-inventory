-- System fallback bucket for records orphaned by Super Admin deletions.
-- The Default business/branch are inactive (hidden from pickers) but remain
-- referenceable so financial and operational history is never lost.
-- Application code must refuse to delete them (see delete-organization).

INSERT INTO businesses (name, category, description, is_active)
VALUES ('Default', 'System', 'System fallback bucket for records orphaned by deletions. Do not delete.', false)
ON CONFLICT (name) DO NOTHING;

INSERT INTO branches (business_id, name, location, is_active)
SELECT b.id, 'Default', 'System fallback', false
FROM businesses b
WHERE b.name = 'Default'
ON CONFLICT (business_id, name) DO NOTHING;
