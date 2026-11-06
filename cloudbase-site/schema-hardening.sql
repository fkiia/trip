REVOKE ALL ON public.trip_settings, public.trip_editors FROM anon, authenticated, PUBLIC;
ALTER TABLE public.trip_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_editors ENABLE ROW LEVEL SECURITY;
