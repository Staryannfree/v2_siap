-- Pivot do vínculo de licença: CPF -> Nome do professor SIAP.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'professores'
      AND column_name = 'cpf_vinculado'
  ) THEN
    ALTER TABLE public.professores
      RENAME COLUMN cpf_vinculado TO nome_vinculado_siap;
  END IF;
END $$;
