CREATE TABLE public.case_inquiry_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Nová otázka',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_inquiry_threads TO authenticated;
GRANT ALL ON public.case_inquiry_threads TO service_role;
ALTER TABLE public.case_inquiry_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inquiry_threads_own" ON public.case_inquiry_threads FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND public.owns_case(case_id));
CREATE INDEX case_inquiry_threads_case_idx ON public.case_inquiry_threads(case_id, updated_at DESC);
CREATE TRIGGER case_inquiry_threads_touch BEFORE UPDATE ON public.case_inquiry_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.case_inquiry_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.case_inquiry_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  unverified text[] NOT NULL DEFAULT '{}',
  model text,
  prompt_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.case_inquiry_messages TO authenticated;
GRANT ALL ON public.case_inquiry_messages TO service_role;
ALTER TABLE public.case_inquiry_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inquiry_messages_select_own" ON public.case_inquiry_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "inquiry_messages_insert_own" ON public.case_inquiry_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND role IN ('user','assistant') AND EXISTS (
    SELECT 1 FROM public.case_inquiry_threads t WHERE t.id = thread_id AND t.user_id = auth.uid()));
CREATE POLICY "inquiry_messages_delete_own" ON public.case_inquiry_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX case_inquiry_messages_thread_idx ON public.case_inquiry_messages(thread_id, created_at);;
