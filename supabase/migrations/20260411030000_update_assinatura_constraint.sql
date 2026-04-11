-- Migração para atualizar a constraint de status_assinatura
-- Permite os novos valores usados pelo frontend e pela automação do Mercado Pago

ALTER TABLE public.professores 
DROP CONSTRAINT IF EXISTS professores_status_assinatura_check;

ALTER TABLE public.professores 
ADD CONSTRAINT professores_status_assinatura_check 
CHECK (status_assinatura IN ('trial', 'pro', 'plus', 'ativa', 'inativa', 'aguardando_pagamento'));

-- Garante que a coluna email continue sendo UNIQUE para o Upsert do Webhook
-- Isso já deve estar no schema original, mas reforçamos por segurança para o onConflict
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'professores_email_key') THEN
        ALTER TABLE public.professores ADD CONSTRAINT professores_email_key UNIQUE (email);
    END IF;
END $$;
