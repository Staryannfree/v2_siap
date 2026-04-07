-- Idempotência: evita duplicar economia de tempo para o mesmo professor, turma, dia e tipo de lançamento.
-- Rode no SQL Editor do Supabase se preferir aplicar manualmente (equivalente a esta migration).

ALTER TABLE public.logs_tempo_salvo
  ADD COLUMN IF NOT EXISTS turma_id text,
  ADD COLUMN IF NOT EXISTS data_aula date;

COMMENT ON COLUMN public.logs_tempo_salvo.turma_id IS 'ID da turma no fluxo mobile/SIAP (pareamento).';
COMMENT ON COLUMN public.logs_tempo_salvo.data_aula IS 'Data civil da aula (timezone do calendário escolar).';

-- Apenas linhas com turma + data participam da unicidade (logs antigos sem esses campos continuam válidos).
CREATE UNIQUE INDEX IF NOT EXISTS logs_tempo_salvo_unique_lancamento_diario
  ON public.logs_tempo_salvo (usuario_id, turma_id, data_aula, tipo_acao)
  WHERE turma_id IS NOT NULL AND data_aula IS NOT NULL;
