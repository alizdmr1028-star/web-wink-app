CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_name text;
BEGIN
  base_name := lower(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)), '[^a-zA-Z0-9_]', '', 'g'));
  IF base_name = '' OR base_name IS NULL THEN
    base_name := 'user' || substr(NEW.id::text, 1, 6);
  END IF;
  INSERT INTO public.profiles (id, display_name, username, avatar_color)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', base_name),
    base_name,
    (ARRAY['#0A84FF','#30D158','#FF9F0A','#FF453A','#BF5AF2','#FF375F','#64D2FF'])[floor(random()*7+1)]
  );
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.invites REPLICA IDENTITY FULL;
ALTER TABLE public.conversation_members REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.invites;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;