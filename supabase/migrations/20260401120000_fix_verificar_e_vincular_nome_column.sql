-- A coluna foi renomeada para nome_vinculado_siap; ajusta RPC legada (assinatura mantida).
CREATE OR REPLACE FUNCTION public.verificar_e_vincular_cpf(p_usuario_id text, p_cpf text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_trim text;
  v_in text;
  v_stored text;
  v_prof_id uuid;
BEGIN
  v_trim := nullif(trim(p_usuario_id), '');
  v_in := nullif(
    trim(regexp_replace(lower(trim(coalesce(p_cpf, ''))), '\s+', ' ', 'g')),
    ''
  );

  IF v_trim IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Identificação do usuário ausente.');
  END IF;

  IF v_in IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Nome não sincronizado. Abra o SIAP no computador para enviar o nome do professor.'
    );
  END IF;

  v_in := regexp_replace(v_in, '^prof\.?\s+', '', 'i');

  SELECT p.id, p.nome_vinculado_siap INTO v_prof_id, v_stored
  FROM public.professores p
  WHERE p.email = v_trim
     OR (p.pareamento_id IS NOT NULL AND p.pareamento_id = v_trim)
     OR p.id::text = v_trim
  LIMIT 1;

  IF v_prof_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Conta não encontrada. Verifique o pareamento ou o login no Turbo.'
    );
  END IF;

  IF v_stored IS NULL OR btrim(v_stored) = '' THEN
    UPDATE public.professores SET nome_vinculado_siap = v_in WHERE id = v_prof_id;
    RETURN jsonb_build_object('ok', true);
  END IF;

  v_stored := trim(regexp_replace(lower(trim(v_stored)), '\s+', ' ', 'g'));
  v_stored := regexp_replace(v_stored, '^prof\.?\s+', '', 'i');

  IF v_stored = v_in OR position(v_in in v_stored) > 0 OR position(v_stored in v_in) > 0 THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', false,
    'error', 'Este acesso está vinculado a outra conta do SIAP. Entre em contato com o suporte para trocar o vínculo.'
  );
END;
$function$;
