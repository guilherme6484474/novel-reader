
-- Assign admin role to gui.cross510@gmail.com
INSERT INTO public.user_roles (user_id, role)
VALUES ('b0c13127-42b4-45a3-8455-b1a05b0c8a1c', 'admin')
ON CONFLICT DO NOTHING;
