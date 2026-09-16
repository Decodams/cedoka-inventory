-- Roles can be deactivated instead of deleted (safer when history exists).
-- Super Admin and Admin rows stay locked at the app and RLS layers.
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
