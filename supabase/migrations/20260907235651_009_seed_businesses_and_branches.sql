/*
# Seed Initial Data: Cedoka Global Businesses and Branches

## Purpose
Populates the platform with the starting organizational structure for Cedoka Global.

## Data Created
1. Business Units: Electronics Retail, Itel Energy, Farm, Ride/Logistics
2. Branches: Awka, Lagos, Ibadan (Electronics Retail); Ejigbo (Itel Energy)

Uses ON CONFLICT DO NOTHING for idempotency.
*/

INSERT INTO businesses (name, category, description) VALUES
  ('Electronics Retail', 'Retail', 'Consumer electronics retail including phones, accessories, and devices.'),
  ('Itel Energy', 'Energy', 'Solar distribution and renewable energy products.'),
  ('Farm', 'Agriculture', 'Agricultural operations and produce.'),
  ('Ride/Logistics', 'Logistics', 'Transportation and logistics services.')
ON CONFLICT (name) DO NOTHING;

INSERT INTO branches (business_id, name, location)
SELECT b.id, branch_name, branch_location
FROM businesses b
CROSS JOIN (VALUES
  ('Awka', 'Awka, Anambra State'),
  ('Lagos', 'Lagos, Lagos State'),
  ('Ibadan', 'Ibadan, Oyo State')
) AS t(branch_name, branch_location)
WHERE b.name = 'Electronics Retail'
ON CONFLICT (business_id, name) DO NOTHING;

INSERT INTO branches (business_id, name, location)
SELECT b.id, 'Ejigbo', 'Ejigbo, Lagos State'
FROM businesses b
WHERE b.name = 'Itel Energy'
ON CONFLICT (business_id, name) DO NOTHING;
