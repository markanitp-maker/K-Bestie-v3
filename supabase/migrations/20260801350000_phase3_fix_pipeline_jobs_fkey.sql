-- Forward Fix for pipeline_jobs.child_id foreign key constraint.
-- Currently it references auth.users(id), which is incorrect and fails manual enqueuing.
-- It should reference child_profiles(id).

ALTER TABLE public.pipeline_jobs
  DROP CONSTRAINT IF EXISTS pipeline_jobs_child_id_fkey,
  ADD CONSTRAINT pipeline_jobs_child_id_fkey 
  FOREIGN KEY (child_id) REFERENCES public.child_profiles(id) ON DELETE CASCADE;
