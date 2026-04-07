-- professores.id como TEXT (e-mail): RLS passa a comparar JWT e-mail à coluna id, não auth.uid().

DROP POLICY IF EXISTS "Professor pode ver o próprio perfil" ON public.professores;
DROP POLICY IF EXISTS "professores_select_admin_ou_proprio" ON public.professores;
DROP POLICY IF EXISTS "professores_update_admin_ou_proprio" ON public.professores;

CREATE POLICY "professores_select_admin_ou_proprio"
ON public.professores
FOR SELECT
TO authenticated
USING (
  lower(trim(coalesce((auth.jwt()->>'email'), ''))) = lower('staryannfree@gmail.com')
  OR lower(trim(coalesce((auth.jwt()->>'email'), ''))) = lower(trim(coalesce(id::text, '')))
);

CREATE POLICY "professores_update_admin_ou_proprio"
ON public.professores
FOR UPDATE
TO authenticated
USING (
  lower(trim(coalesce((auth.jwt()->>'email'), ''))) = lower('staryannfree@gmail.com')
  OR lower(trim(coalesce((auth.jwt()->>'email'), ''))) = lower(trim(coalesce(id::text, '')))
)
WITH CHECK (
  lower(trim(coalesce((auth.jwt()->>'email'), ''))) = lower('staryannfree@gmail.com')
  OR lower(trim(coalesce((auth.jwt()->>'email'), ''))) = lower(trim(coalesce(id::text, '')))
);
