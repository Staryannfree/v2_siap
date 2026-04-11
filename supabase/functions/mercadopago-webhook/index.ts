import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

console.log("Edge Function 'mercadopago-webhook' iniciada!");

serve(async (req) => {
  // O Mercado Pago pode enviar requisições de teste ou métodos diferentes
  if (req.method !== 'POST') {
    return new Response('Somente requisições POST são aceitas', { status: 405 })
  }

  try {
    const body = await req.json()
    console.log('Payload recebido do MP:', JSON.stringify(body))

    // O ID do pagamento vem em 'data.id'
    const paymentId = body?.data?.id
    if (!paymentId) {
      // Retornamos 200 para evitar retentativas se o payload for inválido/vazio
      console.warn('ID do pagamento não encontrado no corpo da requisição.');
      return new Response('ID do pagamento não enviado', { status: 200 })
    }

    const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')
    if (!mpAccessToken) {
      console.error('Erro crítico: MP_ACCESS_TOKEN não configurado nas Secrets do Supabase.');
      return new Response('Configuração ausente', { status: 500 })
    }

    // 1. Consultar a API do Mercado Pago para pegar detalhes do pagamento e o e-mail do pagador
    console.log(`Consultando detalhes do pagamento ${paymentId} no Mercado Pago...`);
    const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${mpAccessToken}`,
        'Content-Type': 'application/json'
      }
    })

    if (!mpResponse.ok) {
      const errorText = await mpResponse.text()
      console.error(`Erro ao consultar MP (Status ${mpResponse.status}):`, errorText);
      // Retornamos 502/503 para que o MP tente novamente mais tarde
      return new Response('Falha na comunicação com API MP', { status: 502 })
    }

    const paymentInfo = await mpResponse.json()
    const paymentStatus = paymentInfo.status
    const payerEmail = paymentInfo.payer?.email

    console.log(`Status do pagamento ${paymentId}: ${paymentStatus} | E-mail: ${payerEmail}`);

    // 2. Se o status for 'approved', atualizamos o professor no banco de dados
    if (paymentStatus === 'approved') {
      if (!payerEmail) {
        console.error('Pagamento aprovado, mas e-mail do pagador está ausente.');
        return new Response('E-mail do pagador ausente', { status: 200 })
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
      const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      
      const supabase = createClient(supabaseUrl, supabaseServiceRole)

      // Upsert: Procura pelo e-mail e atualiza o status para 'pro'. 
      // Se não existir, a função de auth provavelmente ainda não criou a linha, 
      // mas o upsert garante que a preferência do professor já fique guardada.
      const { data, error } = await supabase
        .from('professores')
        .upsert(
          { 
            email: payerEmail.toLowerCase().trim(), 
            status_assinatura: 'pro' 
          }, 
          { onConflict: 'email' }
        )
        .select()

      if (error) {
        console.error('Erro ao salvar no banco de dados Supabase:', error);
        return new Response('Erro ao atualizar banco de dados', { status: 500 })
      }

      console.log(`Sucesso! Professor ${payerEmail} atualizado para status: pro`, data);
      return new Response('Licença liberada com sucesso', { status: 200 })
    }

    // Se o pagamento ainda não foi aprovado (pendente, rejeitado, etc), apenas logamos e retornamos OK
    console.log(`Pagamento ${paymentId} recebido com status: ${paymentStatus}. Nenhuma ação necessária.`);
    return new Response('Processado (sem alteração de status)', { status: 200 })

  } catch (err: any) {
    console.error('Erro ao processar Webhook:', err.message);
    return new Response('Erro interno no servidor', { status: 500 })
  }
})
