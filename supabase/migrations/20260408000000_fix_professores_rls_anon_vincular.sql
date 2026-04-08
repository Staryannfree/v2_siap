-- Correção: Unifica as políticas de primeiro vínculo (Nome/CPF) para o papel 'anon' (Mobile).
-- Isso resolve o erro "new row violates row-level security policy" (Code 42501).

-- 1. Remove as políticas antigas que estavam separadas e causando conflitos de validação no WITH CHECK
DROP POLICY IF EXISTS "professores_update_anon_primeiro_nome_siap" ON public.professores;
DROP POLICY IF EXISTS "professores_update_anon_primeiro_cpf_siap" ON public.professores;

-- 2. Cria a nova política unificada e permissiva para o vínculo inicial
-- Ela permite que o mobile grave o nome OU o CPF, desde que a linha esteja "vazia" (sem vínculo anterior).
CREATE POLICY "professores_update_anon_vincular_inicial"
ON public.professores
FOR UPDATE
TO anon
USING (
  (nome_vinculado_siap IS NULL OR trim(nome_vinculado_siap) = '')
  OR 
  (cpf_vinculado_siap IS NULL OR trim(cpf_vinculado_siap) = '')
)
WITH CHECK (
  -- O resultado final após o update deve ter PELO MENOS UM dos campos preenchidos.
  -- Isso barra updates que tentariam esvaziar os campos ou que não preenchessem nada útil.
  (nome_vinculado_siap IS NOT NULL AND trim(nome_vinculado_siap) <> '')
  OR
  (cpf_vinculado_siap IS NOT NULL AND trim(cpf_vinculado_siap) <> '')
);

-- Garante que o SELECT anônimo continue funcionando para todos (necessário para o pareamento localizar o e-mail)
-- Nota: Esta política já deve existir, mas reforçamos aqui por segurança.
DROP POLICY IF EXISTS "professores_select_anon_pareamento" ON public.professores;
CREATE POLICY "professores_select_anon_pareamento"
ON public.professores
FOR SELECT
TO anon
USING (true);
