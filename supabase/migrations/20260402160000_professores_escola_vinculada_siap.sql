-- Escola do portal SIAP no momento do vínculo (homônimos / identificação extra).
ALTER TABLE public.professores
  ADD COLUMN IF NOT EXISTS escola_vinculada_siap text;

COMMENT ON COLUMN public.professores.escola_vinculada_siap IS
  'Nome da entidade/escola exibido no SIAP (#lblNomeEntidade), para distinguir professores homônimos.';
