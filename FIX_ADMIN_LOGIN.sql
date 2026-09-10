-- ============================================
-- Fix Super Admin Login for admin@cedoka.com
-- ============================================

-- Ensure the roles table has all required roles
INSERT INTO roles (id, name, display_name, description, is_system, created_at) VALUES
  ('00000000-0000-0000-0000-000000000001', 'super_admin', 'Super Admin', 'Full system access across all businesses and branches', true, now()),
  ('00000000-0000-0000-0000-000000000002', 'admin', 'Admin', 'Business-level management access', true, now()),
  ('00000000-0000-0000-0000-000000000003', 'manager', 'Manager', 'Branch-level management access', true, now()),
  ('00000000-0000-0000-0000-000000000004', 'sales_person', 'Sales Person', 'Sales and customer-facing access', true, now())
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- Create or update the admin user profile
-- ============================================
-- First, ensure the auth user exists by calling the Supabase admin auth
-- This script should be run via Supabase SQL editor or the create-user-account function

-- ============================================
-- Deploy the create-user-account function
-- ============================================
SELECT 'Run: supabase functions deploy create-user-account --project-ref erxhhqrzxgsklyhsuulx --use-api';

-- ============================================
-- Business and Branch setup for role scoping
-- ============================================
-- Ensure businesses and branches are properly linked
-- Each branch belongs to one business
-- Users are scoped to businesses and optionally branches

-- Ensure the user_profiles table has proper role-business-branch relationships
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES roles(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);

-- Create index for faster role-business-branch lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_role_id ON user_profiles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_business_id ON user_profiles(business_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_branch_id ON user_profiles(branch_id);

-- ============================================
-- Categories per business
-- ============================================
-- Ensure categories are business-scoped
ALTER TABLE categories ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id);
CREATE INDEX IF NOT EXISTS idx_categories_business_id ON categories(business_id);

-- ============================================
-- Products per business with category scoping
-- ============================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES categories(id);
CREATE INDEX IF NOT EXISTS idx_products_business_id ON products(business_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);

-- ============================================
-- Ensure RLS policies allow branch-scoped reads
-- ============================================
-- Enable RLS on categories if not already
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categories_select_business" ON categories;
CREATE POLICY "categories_select_business" ON categories FOR SELECT TO authenticated USING (business_id IS NULL OR business_id IN (SELECT business_id FROM user_profiles WHERE id = auth.uid()));

-- Enable RLS on products if not already
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "products_select_business" ON products;
CREATE POLICY "products_select_business" ON products FOR SELECT TO authenticated USING (business_id IN (SELECT business_id FROM user_profiles WHERE id = auth.uid()) OR business_id IS NULL);
