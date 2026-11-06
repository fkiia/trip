CREATE TABLE IF NOT EXISTS public.trip_settings (
  id text PRIMARY KEY,
  open_edit boolean NOT NULL DEFAULT true
);
INSERT INTO public.trip_settings (id, open_edit) VALUES ('main', true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.trip_editors (
  visitor_id text PRIMARY KEY,
  allowed boolean NOT NULL DEFAULT true
);

CREATE OR REPLACE FUNCTION public.trip_can_edit() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND auth.uid() <> 'anon'
    AND (
      EXISTS (SELECT 1 FROM public.trip_settings WHERE id = 'main' AND open_edit)
      OR EXISTS (SELECT 1 FROM public.trip_editors WHERE visitor_id = auth.uid() AND allowed)
    );
$$;
REVOKE ALL ON FUNCTION public.trip_can_edit() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trip_can_edit() TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.trip_content (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('day', 'place', 'pick')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trip_content ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.trip_content TO anon, authenticated;
CREATE POLICY trip_content_read ON public.trip_content
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY trip_content_insert ON public.trip_content
  FOR INSERT TO anon, authenticated
  WITH CHECK (public.trip_can_edit() AND actor_id = auth.uid());
CREATE POLICY trip_content_update ON public.trip_content
  FOR UPDATE TO anon, authenticated
  USING (public.trip_can_edit())
  WITH CHECK (public.trip_can_edit() AND actor_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.trip_visitors (
  id text PRIMARY KEY,
  visitor_id text NOT NULL,
  nickname text NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trip_visitors ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.trip_visitors TO anon, authenticated;
CREATE POLICY trip_visitors_insert ON public.trip_visitors
  FOR INSERT TO anon, authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() <> 'anon' AND visitor_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.trip_changes (
  id text PRIMARY KEY,
  visitor_id text NOT NULL,
  nickname text NOT NULL,
  action text NOT NULL,
  target text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trip_changes ENABLE ROW LEVEL SECURITY;
GRANT INSERT ON public.trip_changes TO anon, authenticated;
CREATE POLICY trip_changes_insert ON public.trip_changes
  FOR INSERT TO anon, authenticated
  WITH CHECK (public.trip_can_edit() AND visitor_id = auth.uid());

INSERT INTO storage.buckets
  (id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at)
VALUES ('trip-uploads', 'trip-uploads', true, 4194304, ARRAY['image/jpeg'], now(), now())
ON CONFLICT (id) DO NOTHING;

CREATE POLICY trip_uploads_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'trip-uploads');
CREATE POLICY trip_uploads_insert ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'trip-uploads'
    AND public.trip_can_edit()
    AND (storage.foldername(name))[1] = auth.uid()
  );
