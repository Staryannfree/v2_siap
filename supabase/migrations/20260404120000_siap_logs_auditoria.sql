-- Caixa-preta: tentativas de lançamento do app SIAP (frequência, conteúdo, planejamento).

CREATE TABLE public.siap_logs_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  acao text NOT NULL,
  status text NOT NULL,
  mensagem_erro text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.siap_logs_auditoria IS 'Auditoria de tentativas de lançamento do mobile SIAP.';
COMMENT ON COLUMN public.siap_logs_auditoria.acao IS 'Ex.: tentativa_frequencia, tentativa_conteudo, tentativa_planejamento.';
COMMENT ON COLUMN public.siap_logs_auditoria.status IS 'Ex.: sucesso, duplicado_ignorado, erro_rede, erro_validacao, erro_registro.';

CREATE INDEX IF NOT EXISTS siap_logs_auditoria_created_at_idx
  ON public.siap_logs_auditoria (created_at DESC);

ALTER TABLE public.siap_logs_auditoria ENABLE ROW LEVEL SECURITY;

-- Mobile usa anon key sem sessão JWT típica; inserts abertos, leitura só via service role / SQL Editor.
CREATE POLICY "siap_logs_auditoria_insert_anon"
  ON public.siap_logs_auditoria
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "siap_logs_auditoria_insert_authenticated"
  ON public.siap_logs_auditoria
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
