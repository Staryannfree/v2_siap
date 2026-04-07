-- Âncora de pareamento mobile: CPF capturado no diário (Conteúdo/Frequência).
ALTER TABLE public.professores
  ADD COLUMN IF NOT EXISTS cpf_vinculado_siap text;

COMMENT ON COLUMN public.professores.cpf_vinculado_siap IS
  'CPF do professor no SIAP (somente dígitos), exibido no Histórico detalhado do diário.';

-- Primeiro vínculo pelo app (anon): gravar CPF quando ainda vazio (substitui regra só por nome).
DROP POLICY IF EXISTS "professores_update_anon_primeiro_nome_siap" ON public.professores;

CREATE POLICY "professores_update_anon_primeiro_cpf_siap"
ON public.professores
FOR UPDATE
TO anon
USING (cpf_vinculado_siap IS NULL OR trim(cpf_vinculado_siap) = '')
WITH CHECK (cpf_vinculado_siap IS NOT NULL AND trim(cpf_vinculado_siap) <> '');
