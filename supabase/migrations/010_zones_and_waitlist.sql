-- zones: CABA barrios managed by super_admin
CREATE TABLE IF NOT EXISTS zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE zones ENABLE ROW LEVEL SECURITY;

-- anyone can read (mobile registration form hits this unauthenticated)
CREATE POLICY "zones_public_read" ON zones
  FOR SELECT USING (true);

-- only super_admin can write
CREATE POLICY "zones_super_admin_all" ON zones
  FOR ALL USING (get_my_role() = 'super_admin')
  WITH CHECK (get_my_role() = 'super_admin');

-- seed all 48 CABA barrios, all active by default
INSERT INTO zones (name, active) VALUES
  ('Agronomía',          true),
  ('Almagro',            true),
  ('Balvanera',          true),
  ('Barracas',           true),
  ('Belgrano',           true),
  ('Boedo',              true),
  ('Caballito',          true),
  ('Chacarita',          true),
  ('Coghlan',            true),
  ('Colegiales',         true),
  ('Constitución',       true),
  ('Flores',             true),
  ('Floresta',           true),
  ('La Boca',            true),
  ('La Paternal',        true),
  ('Liniers',            true),
  ('Mataderos',          true),
  ('Monserrat',          true),
  ('Monte Castro',       true),
  ('Nueva Pompeya',      true),
  ('Núñez',              true),
  ('Palermo',            true),
  ('Parque Avellaneda',  true),
  ('Parque Chacabuco',   true),
  ('Parque Chas',        true),
  ('Parque Patricios',   true),
  ('Puerto Madero',      true),
  ('Recoleta',           true),
  ('Retiro',             true),
  ('Saavedra',           true),
  ('San Cristóbal',      true),
  ('San Nicolás',        true),
  ('San Telmo',          true),
  ('Vélez Sársfield',    true),
  ('Versalles',          true),
  ('Villa Crespo',       true),
  ('Villa del Parque',   true),
  ('Villa Devoto',       true),
  ('Villa General Mitre',true),
  ('Villa Lugano',       true),
  ('Villa Luro',         true),
  ('Villa Ortúzar',      true),
  ('Villa Pueyrredón',   true),
  ('Villa Real',         true),
  ('Villa Riachuelo',    true),
  ('Villa Santa Rita',   true),
  ('Villa Soldati',      true),
  ('Villa Urquiza',      true)
ON CONFLICT (name) DO NOTHING;

-- waitlist: non-CABA users who want to be notified when we expand
CREATE TABLE IF NOT EXISTS waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  nombre     text NOT NULL DEFAULT '',
  apellido   text NOT NULL DEFAULT '',
  provincia  text NOT NULL,
  ciudad     text NOT NULL DEFAULT '',
  notified   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- anyone (anon) can insert
CREATE POLICY "waitlist_insert_anon" ON waitlist
  FOR INSERT WITH CHECK (true);

-- only super_admin can read / update
CREATE POLICY "waitlist_super_admin_select" ON waitlist
  FOR SELECT USING (get_my_role() = 'super_admin');

CREATE POLICY "waitlist_super_admin_update" ON waitlist
  FOR UPDATE USING (get_my_role() = 'super_admin');
