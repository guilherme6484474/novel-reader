
-- Table to track TTS API usage
CREATE TABLE public.tts_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  characters_count int NOT NULL DEFAULT 0,
  engine text NOT NULL DEFAULT 'google',
  lang text NOT NULL DEFAULT 'pt-BR',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for fast queries by date and user
CREATE INDEX idx_tts_usage_created_at ON public.tts_usage (created_at DESC);
CREATE INDEX idx_tts_usage_user_id ON public.tts_usage (user_id);

-- Enable RLS
ALTER TABLE public.tts_usage ENABLE ROW LEVEL SECURITY;

-- Edge function inserts via service role, so no INSERT policy needed for anon
-- Only admins can SELECT usage data
-- We'll use a roles system for this

-- Create role enum and roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS: only admins can view TTS usage
CREATE POLICY "Admins can view all TTS usage"
ON public.tts_usage
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- RLS: only admins can view roles
CREATE POLICY "Admins can view roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Allow edge function (service role) to insert usage
CREATE POLICY "Service role can insert usage"
ON public.tts_usage
FOR INSERT
WITH CHECK (true);
