-- Reset Arteaga's password using the same bcrypt cost as migration 002
UPDATE auth.users
SET encrypted_password = extensions.crypt('DemoUser2026!', extensions.gen_salt('bf', 10))
WHERE email = 'ignacio.arteaga@healthier.app';
