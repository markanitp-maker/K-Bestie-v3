ALTER TABLE public.acquisition_links
  ALTER COLUMN destination_path SET DEFAULT '/';

UPDATE public.acquisition_links
SET destination_path = '/'
WHERE destination_path = '/signup'
  AND deleted_at IS NULL;
