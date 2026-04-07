-- Mobile pareado (sem auth.uid): role `anon` precisa ler `professores` pelo e-mail do QR/broadcast
-- e gravar `nome_vinculado_siap` apenas quando ainda estiver vazio (primeiro vínculo).
--
-- Risco: qualquer cliente com a anon key pode SELECT em todas as linhas de `professores`.
-- Alternativa mais restrita: RPCs SECURITY DEFINER por e-mail (evoluir depois se necessário).

DROP POLICY IF EXISTS "professores_select_anon_pareamento" ON public.professores;

CREATE POLICY "professores_select_anon_pareamento"
ON public.professores
FOR SELECT
TO anon
USING (true);

DROP POLICY IF EXISTS "professores_update_anon_primeiro_nome_siap" ON public.professores;

CREATE POLICY "professores_update_anon_primeiro_nome_siap"
ON public.professores
FOR UPDATE
TO anon
USING (nome_vinculado_siap IS NULL OR trim(nome_vinculado_siap) = '')
WITH CHECK (nome_vinculado_siap IS NOT NULL AND trim(nome_vinculado_siap) <> '');
