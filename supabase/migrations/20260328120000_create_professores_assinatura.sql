-- Perfis de professores + assinatura (Mercado Pago).
-- Execute no Supabase: SQL Editor → New query → Run (uma vez por projeto).

-- Cria a tabela de perfis dos professores
CREATE TABLE public.professores (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  status_assinatura TEXT DEFAULT 'inativa' CHECK (status_assinatura IN ('ativa', 'inativa', 'aguardando_pagamento')),
  data_vencimento TIMESTAMP WITH TIME ZONE,
  mp_payment_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilita RLS (Row Level Security)
ALTER TABLE public.professores ENABLE ROW LEVEL SECURITY;

-- Professor só lê o próprio registro
CREATE POLICY "Professor pode ver o próprio perfil"
ON public.professores
FOR SELECT
USING (auth.uid() = id);

-- Trigger: novo usuário no Auth → linha em public.professores
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.professores (id, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, NEW.id::text || '@sem-email.supabase')
  );
  RETURN NEW;
END;
$$;

-- PostgreSQL 14+ / Supabase: use EXECUTE FUNCTION (EXECUTE PROCEDURE é legado)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
