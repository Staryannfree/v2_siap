-- Garante que todo usuário do Auth possua linha correspondente em public.professores.
-- Corrige ambientes onde o trigger foi criado depois dos cadastros iniciais.

INSERT INTO public.professores (id, email, status_assinatura)
SELECT
  u.id,
  COALESCE(NULLIF(lower(trim(u.email)), ''), u.id::text || '@sem-email.supabase'),
  'trial'
FROM auth.users u
LEFT JOIN public.professores p
  ON p.id = u.id
WHERE p.id IS NULL;
