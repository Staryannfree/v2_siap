-- Mobile (anon): primeiro vínculo por nome, em paralelo à política que exige CPF no primeiro update.
-- Com ambas permissivas, WITH CHECK combina com OR: update só com nome ou só com CPF pode passar.

CREATE POLICY "professores_update_anon_primeiro_nome_siap"
ON public.professores
FOR UPDATE
TO anon
USING (nome_vinculado_siap IS NULL OR trim(nome_vinculado_siap) = '')
WITH CHECK (nome_vinculado_siap IS NOT NULL AND trim(nome_vinculado_siap) <> '');
