ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

DROP POLICY IF EXISTS "Users can update own messages" ON public.messages;
CREATE POLICY "Users can update own messages" ON public.messages
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own messages" ON public.messages;
CREATE POLICY "Users can delete own messages" ON public.messages
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.message_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('edit','delete')),
  previous_content text NOT NULL,
  new_content text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.message_history TO authenticated;
GRANT ALL ON public.message_history TO service_role;

ALTER TABLE public.message_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own message history" ON public.message_history;
CREATE POLICY "Users can view own message history" ON public.message_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.log_message_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    INSERT INTO public.message_history (message_id, user_id, action, previous_content, new_content)
    VALUES (OLD.id, OLD.user_id, 'delete', OLD.content, NULL);
  ELSIF NEW.content IS DISTINCT FROM OLD.content THEN
    INSERT INTO public.message_history (message_id, user_id, action, previous_content, new_content)
    VALUES (OLD.id, OLD.user_id, 'edit', OLD.content, NEW.content);
    NEW.edited_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_log_change ON public.messages;
CREATE TRIGGER messages_log_change
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.log_message_change();

ALTER TABLE public.messages REPLICA IDENTITY FULL;