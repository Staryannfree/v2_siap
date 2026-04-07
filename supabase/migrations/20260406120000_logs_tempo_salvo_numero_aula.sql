-- Idempotência por aula do dia: permite 1ª e 2ª aula (geminadas) no mesmo dia/turma.
-- Remove o índice antigo (sem número da aula) e recria com numero_aula na chave.

DROP INDEX IF EXISTS logs_tempo_salvo_unique_lancamento_diario;

ALTER TABLE public.logs_tempo_salvo
  ADD COLUMN IF NOT EXISTS numero_aula text;

COMMENT ON COLUMN public.logs_tempo_salvo.numero_aula IS
  'Identificador da aula no dia (ex.: valor do dropdown SIAP) para distinguir aulas geminadas.';

CREATE UNIQUE INDEX logs_tempo_salvo_unique_lancamento_diario
  ON public.logs_tempo_salvo (usuario_id, turma_id, data_aula, tipo_acao, numero_aula)
  WHERE turma_id IS NOT NULL AND data_aula IS NOT NULL AND numero_aula IS NOT NULL;
