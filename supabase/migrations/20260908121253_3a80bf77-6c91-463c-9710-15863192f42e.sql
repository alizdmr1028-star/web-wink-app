-- profiles: username
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
UPDATE public.profiles SET username = lower(regexp_replace(coalesce(display_name,'user'), '[^a-zA-Z0-9_]', '', 'g')) || '_' || substr(id::text,1,4) WHERE username IS NULL;
ALTER TABLE public.profiles ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_key ON public.profiles (lower(username));

CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.conversation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_members TO authenticated;
GRANT ALL ON public.conversation_members TO service_role;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_conversation_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.conversation_members m WHERE m.conversation_id = _conversation_id AND m.user_id = _user_id)
$$;

CREATE POLICY "members read conversations" ON public.conversations FOR SELECT TO authenticated
  USING (public.is_conversation_member(id, auth.uid()));
CREATE POLICY "users create conversations" ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY "members delete conversations" ON public.conversations FOR DELETE TO authenticated
  USING (public.is_conversation_member(id, auth.uid()));

CREATE POLICY "members read membership" ON public.conversation_members FOR SELECT TO authenticated
  USING (public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY "insert own or by creator" ON public.conversation_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.conversations c WHERE c.id = conversation_id AND c.created_by = auth.uid())
  );
CREATE POLICY "leave conversation" ON public.conversation_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  from_user uuid NOT NULL,
  to_user uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own invites" ON public.invites FOR SELECT TO authenticated
  USING (from_user = auth.uid() OR to_user = auth.uid());
CREATE POLICY "send invites" ON public.invites FOR INSERT TO authenticated
  WITH CHECK (from_user = auth.uid());
CREATE POLICY "respond to invites" ON public.invites FOR UPDATE TO authenticated
  USING (to_user = auth.uid() OR from_user = auth.uid())
  WITH CHECK (to_user = auth.uid() OR from_user = auth.uid());
CREATE POLICY "delete own invites" ON public.invites FOR DELETE TO authenticated
  USING (from_user = auth.uid() OR to_user = auth.uid());

-- messages additions
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_type text,
  ADD COLUMN IF NOT EXISTS view_once boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS liked_by uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

DROP POLICY IF EXISTS "Anyone can read messages" ON public.messages;
DROP POLICY IF EXISTS "Authenticated users can read messages" ON public.messages;
DROP POLICY IF EXISTS "Users can insert their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update their own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can delete their own messages" ON public.messages;
DROP POLICY IF EXISTS "conv members read messages" ON public.messages;

CREATE POLICY "conv members read messages" ON public.messages FOR SELECT TO authenticated
  USING (conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY "conv members send messages" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY "conv members update messages" ON public.messages FOR UPDATE TO authenticated
  USING (conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id, auth.uid()))
  WITH CHECK (conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id, auth.uid()));
CREATE POLICY "conv members delete messages" ON public.messages FOR DELETE TO authenticated
  USING (conversation_id IS NOT NULL AND public.is_conversation_member(conversation_id, auth.uid()));

-- storage policies for media bucket (bucket created separately)
CREATE POLICY "members read media" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'media' AND public.is_conversation_member(((storage.foldername(name))[1])::uuid, auth.uid()));
CREATE POLICY "members upload media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND public.is_conversation_member(((storage.foldername(name))[1])::uuid, auth.uid()));
CREATE POLICY "members delete media" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND public.is_conversation_member(((storage.foldername(name))[1])::uuid, auth.uid()));